"use client";
import { useEffect, useState } from "react";
import { preferredVoiceSource, setPreferredVoiceSource } from "../services/naturalSpeech";
import { screenSpeech } from "./screens/screenSpeech";

export function SpeechQualitySettings() {
  const [source, setSource] = useState(preferredVoiceSource);
  const [available, setAvailable] = useState<boolean>();
  const [message, setMessage] = useState("");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/speech", { credentials: "same-origin", signal: AbortSignal.timeout(8000) }).then(async (r) => { if (r.ok && active) setAvailable(Boolean((await r.json()).available)); }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; screenSpeech.cancel(); };
  }, []);
  const preview = () => {
    setMessage(""); setPlaying(true);
    void screenSpeech.speak("Could you send me the details? I'll get back to you as soon as I can.", "en-US").then(() => setMessage(screenSpeech.lastSource === "natural" ? "正在使用自然美式发音；手机和电脑使用同一音色。" : screenSpeech.lastSource === "fallback" ? "自然发音暂不可用，本次使用了设备语音。" : "本次使用设备语音。" )).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "试听失败，请重试。")).finally(() => setPlaying(false));
  };
  return <div className="speech-quality"><fieldset><legend>发音音质（本设备）</legend><label><input type="radio" name="voice-source" checked={source === "natural"} onChange={() => { screenSpeech.cancel(); setSource("natural"); setPreferredVoiceSource("natural"); }} />自然美式发音 <small>手机、电脑使用同一音色</small></label><label><input type="radio" name="voice-source" checked={source === "device"} onChange={() => { screenSpeech.cancel(); setSource("device"); setPreferredVoiceSource("device"); }} />设备语音 <small>优先使用已安装的高品质音色</small></label></fieldset><p>自然发音会将需要朗读的文字发送给语音服务，录音不会上传。英式英语仍使用设备音色。</p>{available === false && <p>服务器暂未启用自然发音，当前使用设备语音。</p>}<button className="secondary" disabled={playing} onClick={preview}>{playing ? "正在准备 / 播放…" : "试听美式发音"}</button>{message && <p role="status">{message}</p>}</div>;
}
