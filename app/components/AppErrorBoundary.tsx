"use client";

import { Component, type ReactNode } from "react";
import type { DiagnosticReporter } from "../services/diagnostics";

export class AppErrorBoundary extends Component<{ children: ReactNode; reporter: DiagnosticReporter }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() {
    this.props.reporter("render_error", { screen: "app", ...(typeof navigator === "undefined" ? {} : { online: navigator.onLine }) });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="loading"><p role="alert">页面遇到异常，学习数据仍保存在云端。</p><button type="button" onClick={() => window.location.reload()}>重新打开</button></main>;
  }
}
