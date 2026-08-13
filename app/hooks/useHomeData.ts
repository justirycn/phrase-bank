"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildLearningHeatmap } from "../domain/learningHeatmap";
import { loadHomeData, shanghaiOutcomeRange, summarizeHomeOutcomes, type HomeData } from "../services/homeData";
import type { PhraseRepository } from "../storage/repository";

export interface HomeDataController {
  data?: HomeData;
  readyRepository?: PhraseRepository;
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

interface RepositoryData {
  repository: PhraseRepository;
  value: HomeData;
}

export function useHomeData(
  repository: PhraseRepository | undefined,
  now: () => Date = systemNow,
): HomeDataController {
  const [repositoryData, setRepositoryData] = useState<RepositoryData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dataRef = useRef<RepositoryData>();
  const mountedRef = useRef(false);
  const coreGenerationRef = useRef(0);
  const heatmapGenerationRef = useRef(0);

  const replaceData = useCallback((next: RepositoryData | undefined) => {
    dataRef.current = next;
    if (mountedRef.current) setRepositoryData(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!repository) return;
    const generation = ++coreGenerationRef.current;
    const heatmapGeneration = heatmapGenerationRef.current;
    const hadData = dataRef.current?.repository === repository;
    if (mountedRef.current) {
      setError("");
      setLoading(!hadData);
    }
    try {
      const next = await loadHomeData(repository, now());
      if (!mountedRef.current || generation !== coreGenerationRef.current) return;
      const latest = dataRef.current;
      const value = heatmapGeneration !== heatmapGenerationRef.current && latest?.repository === repository
        ? { ...next, events: latest.value.events, heatmap: latest.value.heatmap, heatmapError: latest.value.heatmapError }
        : next;
      replaceData({ repository, value });
      setError("");
    } catch {
      if (!mountedRef.current || generation !== coreGenerationRef.current) return;
      setError(hadData ? REFRESH_ERROR : INITIAL_ERROR);
    } finally {
      if (mountedRef.current && generation === coreGenerationRef.current) setLoading(false);
    }
  }, [now, replaceData, repository]);

  const retry = useCallback(() => refresh(), [refresh]);

  const retryHeatmap = useCallback(async () => {
    const snapshot = dataRef.current;
    if (!repository || snapshot?.repository !== repository) return;
    const generation = ++heatmapGenerationRef.current;
    const currentNow = now();
    const { from, to } = shanghaiOutcomeRange(currentNow);
    try {
      const events = await repository.listTrainingEvents(from, to);
      if (!mountedRef.current || generation !== heatmapGenerationRef.current) return;
      const latest = dataRef.current;
      if (latest?.repository !== repository) return;
      const outcomes = await summarizeHomeOutcomes(events, latest.value.trainingSessions, latest.value.learningStates, currentNow);
      if (!mountedRef.current || generation !== heatmapGenerationRef.current || dataRef.current?.repository !== repository) return;
      replaceData({ repository, value: {
        ...latest.value, outcomes, events, heatmap: buildLearningHeatmap(events, currentNow), heatmapError: "",
      } });
    } catch {
      if (!mountedRef.current || generation !== heatmapGenerationRef.current) return;
      const latest = dataRef.current;
      if (latest?.repository !== repository) return;
      replaceData({ repository, value: { ...latest.value, heatmapError: HEATMAP_ERROR } });
    }
  }, [now, replaceData, repository]);

  useEffect(() => {
    mountedRef.current = true;
    if (!repository) {
      const generation = ++coreGenerationRef.current;
      heatmapGenerationRef.current += 1;
      void Promise.resolve().then(() => {
        if (!mountedRef.current || generation !== coreGenerationRef.current) return;
        replaceData(undefined);
        setLoading(false);
        setError("");
      });
    } else {
      void refresh();
    }
    return () => {
      mountedRef.current = false;
      coreGenerationRef.current += 1;
      heatmapGenerationRef.current += 1;
    };
  }, [now, refresh, replaceData, repository]);

  const data = repository && repositoryData?.repository === repository ? repositoryData.value : undefined;
  const readyRepository = data ? repository : undefined;
  return { data, readyRepository, loading, error, refresh, retry, retryHeatmap };
}
