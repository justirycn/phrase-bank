"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { AppIcon } from "../AppIcon";
import type { Category, PhraseInput, PhraseLearningState } from "../../domain/types";
import { validatePhraseInput, type PhraseErrors } from "../../domain/validation";

export type AddSaveResult = { status: "saved" } | { status: "partial"; state: PhraseLearningState };

function resetAddPhraseVisibleScope(setSaving: (value: boolean) => void, setSaveError: (value: string) => void, hasPartial: boolean) {
  setSaving(false);
  setSaveError(hasPartial ? "句子已保存，但设置为已学习失败，目前按未学习处理。" : "");
}

export default function AddPhrase({ categories, onSave, onRetryState, onComplete, onCancel }: { categories: Category[]; onSave: (input: PhraseInput, learnFirst: boolean) => Promise<AddSaveResult>; onRetryState: (state: PhraseLearningState) => Promise<void>; onComplete: () => Promise<void>; onCancel: () => void }) {
  const [input, setInput] = useState<PhraseInput>({ english: "", chinese: "", categoryId: categories[0]?.id ?? "daily", personalExample: "", sourceNote: "" });
  const [errors, setErrors] = useState<PhraseErrors>({});
  const [more, setMore] = useState(false);
  const [learnFirst, setLearnFirst] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [partialState, setPartialState] = useState<PhraseLearningState>();
  const [saving, setSaving] = useState(false);
  const operationRef = useRef<symbol>();
  const partialRef = useRef<PhraseLearningState>();
  const mountedRef = useRef(true);
  const scopeRef = useRef({ onSave, onRetryState, onComplete });
  const scopeGenerationRef = useRef(0);
  useLayoutEffect(() => {
    scopeRef.current = { onSave, onRetryState, onComplete };
    scopeGenerationRef.current += 1;
    operationRef.current = undefined;
    resetAddPhraseVisibleScope(setSaving, setSaveError, Boolean(partialRef.current));
  }, [onComplete, onRetryState, onSave]);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeGenerationRef.current += 1;
      operationRef.current = undefined;
    };
  }, []);
  const field = (key: keyof PhraseInput, value: string) => setInput((old) => ({ ...old, [key]: value }));
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (operationRef.current || partialRef.current) return; const token = Symbol("phrase-save"); const scope = scopeGenerationRef.current; operationRef.current = token; setSaving(true); const next = validatePhraseInput(input); setErrors(next); if (Object.keys(next).length) { operationRef.current = undefined; setSaving(false); return; } setSaveError(""); try { const result = await onSave(input, learnFirst); if (!mountedRef.current || operationRef.current !== token || scopeGenerationRef.current !== scope) return; if (result.status === "partial") { partialRef.current = result.state; setPartialState(result.state); setSaveError("句子已保存，但设置为已学习失败，目前按未学习处理。"); } else { await onComplete(); } } catch { if (mountedRef.current && operationRef.current === token && scopeGenerationRef.current === scope) setSaveError("句子保存失败，请检查本地存储后重试。"); } finally { if (operationRef.current === token) { operationRef.current = undefined; if (mountedRef.current) setSaving(false); } } };
  const retryState = async () => { if (operationRef.current || !partialRef.current) return; const token = Symbol("state-retry"); const scope = scopeGenerationRef.current; const state = partialRef.current; operationRef.current = token; setSaving(true); setSaveError(""); try { await onRetryState(state); if (!mountedRef.current || operationRef.current !== token || scopeGenerationRef.current !== scope) return; await onComplete(); } catch { if (mountedRef.current && operationRef.current === token && scopeGenerationRef.current === scope) setSaveError("已保存句子，但设置为已学习仍然失败，请重试。"); } finally { if (operationRef.current === token) { operationRef.current = undefined; if (mountedRef.current) setSaving(false); } } };
  return <><header className="screen-head"><button className="icon-button" onClick={onCancel} aria-label="返回"><AppIcon name="back" size={24} /></button><div><h1>收藏语言块</h1><p>Save a phrase you’ll actually use.</p></div></header>
    <form className="phrase-form" onSubmit={submit}>
      <label>英文表达<textarea aria-label="英文表达" value={input.english} onChange={(e) => field("english", e.target.value)} placeholder="e.g. I haven't decided yet." rows={3} />{errors.english && <small className="field-error">{errors.english}</small>}</label>
      <label>中文含义<textarea aria-label="中文含义" value={input.chinese} onChange={(e) => field("chinese", e.target.value)} placeholder="我还没决定。" rows={2} />{errors.chinese && <small className="field-error">{errors.chinese}</small>}</label>
      <label>分类<select aria-label="分类" value={input.categoryId} onChange={(e) => field("categoryId", e.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{errors.categoryId && <small className="field-error">{errors.categoryId}</small>}</label>
      <button className="more-button" type="button" onClick={() => setMore(!more)}>{more ? "收起选填内容" : <><AppIcon name="add" size={14} /> 添加我的例句或来源</>}</button>
      {more && <div className="optional-fields"><label>我的例句<textarea value={input.personalExample} onChange={(e) => field("personalExample", e.target.value)} rows={2} /></label><label>来源或备注<input value={input.sourceNote} onChange={(e) => field("sourceNote", e.target.value)} /></label></div>}
      <label><input type="checkbox" checked={learnFirst} onChange={(event) => setLearnFirst(event.target.checked)} />先在“学习新句”里认识这句话</label>
      {saveError && <p className="field-error" role="alert">{saveError}</p>}
      {partialState && <button type="button" disabled={saving} onClick={() => { void retryState(); }}>只重试学习状态</button>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>取消</button><button className="primary" type="submit" aria-label="保存语言块" disabled={saving || Boolean(partialState)}>{saving ? "正在保存" : "保存语言块"}</button></div>
    </form></>;
}
