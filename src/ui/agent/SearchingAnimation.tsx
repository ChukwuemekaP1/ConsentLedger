"use client";

import { useEffect, useState } from "react";

export interface SearchingAnimationProps {
  readonly queryPrompt: string;
}

const SEARCH_STAGES = [
  {
    icon: "🧠",
    title: "Analyzing Request",
    detail: "Interpreting item specifications, budget ceiling & quality requirements...",
  },
  {
    icon: "🌐",
    title: "Querying Catalogs",
    detail: "Connecting to real merchant product inventories via Channel3...",
  },
  {
    icon: "🔍",
    title: "Comparing Options",
    detail: "Filtering real SKUs, merchant reliability & unit prices...",
  },
  {
    icon: "⚖️",
    title: "Evaluating Value Density",
    detail: "Synthesizing rationale & comparing against overpriced alternatives...",
  },
  {
    icon: "🔒",
    title: "Guarding Policy Limits",
    detail: "Validating against your transaction cap before preparing mandate...",
  },
] as const;

export function SearchingAnimation({ queryPrompt }: SearchingAnimationProps) {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStageIndex((prev) => (prev < SEARCH_STAGES.length - 1 ? prev + 1 : prev));
    }, 2400);
    return () => clearInterval(timer);
  }, []);

  const currentStage = SEARCH_STAGES[stageIndex] ?? SEARCH_STAGES[0];

  return (
    <div className="search-anim-container" role="status" aria-live="polite">
      {/* Top Pulse Badge */}
      <div className="search-anim-header">
        <div className="search-anim-badge">
          <span className="search-anim-beacon" aria-hidden="true" />
          <span>Autonomous AI Agent at Work</span>
        </div>
        <p className="search-anim-prompt">
          Searching the catalog and drafting a proposal for “{queryPrompt.trim()}”…
        </p>
      </div>

      {/* Main Stepper Card */}
      <div className="search-stepper-card">
        <div className="search-stage-visual">
          <div className="search-stage-icon-circle">
            <span className="search-stage-icon" role="img" aria-hidden="true">
              {currentStage.icon}
            </span>
          </div>
          <div className="search-stage-text">
            <h3 className="search-stage-title">{currentStage.title}</h3>
            <p className="search-stage-detail">{currentStage.detail}</p>
          </div>
        </div>

        {/* Multi-step progress bar */}
        <div className="search-progress-track" aria-hidden="true">
          <div
            className="search-progress-fill"
            style={{ width: `${((stageIndex + 1) / SEARCH_STAGES.length) * 100}%` }}
          />
        </div>

        {/* Step dots */}
        <div className="search-steps-row">
          {SEARCH_STAGES.map((s, idx) => {
            const isDone = idx < stageIndex;
            const isCurrent = idx === stageIndex;
            return (
              <div
                key={s.title}
                className={`search-step-pill ${isDone ? "is-done" : isCurrent ? "is-active" : ""}`}
              >
                <span>{s.icon}</span>
                <span className="search-step-pill-label">{s.title}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Shimmer Store Discovery Previews */}
      <div className="search-store-scanners">
        <div className="search-scanner-label">
          <span>Active Merchant Catalog Streams:</span>
          <span className="search-scanner-badge">Channel3 Live</span>
        </div>

        <div className="search-shimmer-grid" aria-hidden="true">
          {[1, 2, 3].map((cardIdx) => (
            <div key={cardIdx} className="search-shimmer-card">
              <div className="search-shimmer-img" />
              <div className="search-shimmer-lines">
                <div className="search-shimmer-line search-shimmer-line--title" />
                <div className="search-shimmer-line search-shimmer-line--price" />
                <div className="search-shimmer-line search-shimmer-line--sub" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reassurance Footer */}
      <div className="search-anim-footer">
        <span>
          🛡️ <strong>Zero Risk:</strong> The agent can only draft proposals. Funds are locked until
          you sign with your device passkey.
        </span>
      </div>
    </div>
  );
}
