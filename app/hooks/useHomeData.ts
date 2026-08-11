"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildLearningHeatmap } from "../domain/learningHeatmap";
import { loadHomeData, shanghaiHeatmapRange, type HomeData } from "../services/homeData";
import type { PhraseRepository } from "../storage/repository";

export interface HomeDataController {
  data?: HomeData;
  loading: boolean;
  error: string;
  refresh(): Promise<void>;
  retry(): Promise<void>;
  retryHeatmap(): Promise<void>;
}

const systemNow = () => new Date();
const INITIAL_ERROR = "本地数据暂时无法打开，请刷新后重试。";
const REFRESH_ERROR = "本地数据暂时无法刷新，你仍然可以继续使用。";
const HEATMAP_ERROR = "学习足迹暂时无法加载";

export function useHomeData(
  repository: PhraseRepository | undefined,
  now: () => Date = systemNow,
): HomeDataController {
  const [data, setData] = useState<HomeData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dataRef = useRef<HomeData>();
  const mountedRef = useRef(false);
  const generationRef = useRef(0);

  const replaceData = useCallback((next: HomeData | undefined) => {
    dataRef.current = next;
    if (mountedRef.current) setData(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!repository) return;
    const generation = ++generationRef.current;
    const hadData = dataRef.current !== undefined;
    if (mountedRef.current) {
      setError("");
      setLoading(!hadData);
    }
    try {
      const next = await loadHomeData(repository, now());
      if (!mountedRef.current || generation !== generationRef.current) return;
      replaceData(next);
      setError("");
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setError(hadData ? REFRESH_ERROR : INITIAL_ERROR);
    } finally {
      if (mountedRef.current && generation === generationRef.current) setLoading(false);
    }
  }, [now, replaceData, repository]);

  const retry = useCallback(() => refresh(), [refresh]);

  const retryHeatmap = useCallback(async () => {
    const current = dataRef.current;
    if (!repository || !current) return;
    const generation = ++generationRef.current;
    const currentNow = now();
    const { from, to } = shanghaiHeatmapRange(currentNow);
    try {
      const events = await repository.listTrainingEvents(from, to);
      if (!mountedRef.current || generation !== generationRef.current) return;
      replaceData({
        ...current,
        events,
        heatmap: buildLearningHeatmap(events, currentNow),
        heatmapError: "",
      });
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return;
      replaceData({ ...current, heatmapError: HEATMAP_ERROR });
    }
  }, [now, replaceData, repository]);

  useEffect(() => {
    mountedRef.current = true;
    if (!repository) {
      const generation = ++generationRef.current;
      void Promise.resolve().then(() => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        replaceData(undefined);
        setLoading(false);
        setError("");
      });
    } else {
      void refresh();
    }
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, [now, refresh, replaceData, repository]);

  return { data, loading, error, refresh, retry, retryHeatmap };
}
