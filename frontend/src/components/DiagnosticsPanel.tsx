import { useState } from "react";

import { UiIcon } from "./UiIcon";
import styles from "./DiagnosticsPanel.module.css";

export type DiagnosticsTab = "issues" | "progress";

export type DiagnosticsRunState =
  | "idle"
  | "validating"
  | "running"
  | "success"
  | "error";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticIssue {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  message?: string;
  blockId?: string;
  blockLabel?: string;
}

export type DiagnosticProgressStatus = "pending" | "active" | "done" | "error";

export interface DiagnosticProgressItem {
  id: string;
  label: string;
  status: DiagnosticProgressStatus;
  detail?: string;
}

export interface DiagnosticsPanelProps {
  state: DiagnosticsRunState;
  issues?: readonly DiagnosticIssue[];
  progress?: readonly DiagnosticProgressItem[];
  activeTab?: DiagnosticsTab;
  defaultActiveTab?: DiagnosticsTab;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  statusLabel?: string;
  className?: string;
  onTabChange?: (tab: DiagnosticsTab) => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  onIssueClick?: (issue: DiagnosticIssue) => void;
}

const STATE_LABELS: Record<DiagnosticsRunState, string> = {
  idle: "Ожидание запуска",
  validating: "Проверка схемы",
  running: "Выполняется расчёт",
  success: "Расчёт завершён",
  error: "Требуется исправление",
};

const TAB_LABELS: Record<DiagnosticsTab, string> = {
  issues: "Проблемы",
  progress: "Ход расчёта",
};

function mergeClassNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function DiagnosticsPanel({
  state,
  issues = [],
  progress = [],
  activeTab,
  defaultActiveTab = "issues",
  collapsed,
  defaultCollapsed = false,
  statusLabel,
  className,
  onTabChange,
  onCollapsedChange,
  onIssueClick,
}: DiagnosticsPanelProps) {
  const [internalTab, setInternalTab] = useState<DiagnosticsTab>(defaultActiveTab);
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);

  const selectedTab = activeTab ?? internalTab;
  const isCollapsed = collapsed ?? internalCollapsed;

  const selectTab = (tab: DiagnosticsTab) => {
    if (activeTab === undefined) {
      setInternalTab(tab);
    }
    onTabChange?.(tab);
    if (isCollapsed) {
      if (collapsed === undefined) {
        setInternalCollapsed(false);
      }
      onCollapsedChange?.(false);
    }
  };

  const toggleCollapsed = () => {
    const nextValue = !isCollapsed;
    if (collapsed === undefined) {
      setInternalCollapsed(nextValue);
    }
    onCollapsedChange?.(nextValue);
  };

  return (
    <section
      className={mergeClassNames(
        styles.panel,
        styles[`state-${state}`],
        isCollapsed && styles.collapsed,
        className,
      )}
      aria-label="Инженерная диагностика модели"
      data-testid="diagnostics-panel"
      data-state={state}
    >
      <header className={styles.header}>
        <div className={styles.status} aria-live="polite">
          <span className={styles.statusIndicator} aria-hidden="true" />
          <span className={styles.statusLabel}>{statusLabel ?? STATE_LABELS[state]}</span>
        </div>

        <nav className={styles.tabs} aria-label="Разделы диагностики" role="tablist">
          {(Object.keys(TAB_LABELS) as DiagnosticsTab[]).map((tab) => {
            const isSelected = selectedTab === tab;
            const badgeValue =
              tab === "issues" ? issues.length : progress.length;

            return (
              <button
                key={tab}
                type="button"
                className={mergeClassNames(styles.tab, isSelected && styles.activeTab)}
                aria-selected={isSelected}
                role="tab"
                onClick={() => selectTab(tab)}
              >
                <span>{TAB_LABELS[tab]}</span>
                {badgeValue > 0 && <span className={styles.tabCount}>{badgeValue}</span>}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          className={styles.collapseButton}
          onClick={toggleCollapsed}
          aria-label={isCollapsed ? "Развернуть панель диагностики" : "Свернуть панель диагностики"}
          aria-expanded={!isCollapsed}
        >
          <UiIcon name="chevron" className={styles.chevron} />
        </button>
      </header>

      {!isCollapsed && (
        <div className={styles.body} role="tabpanel">
          {selectedTab === "issues" && (
            <IssuesView issues={issues} onIssueClick={onIssueClick} />
          )}
          {selectedTab === "progress" && <ProgressView items={progress} state={state} />}
        </div>
      )}
    </section>
  );
}

interface IssuesViewProps {
  issues: readonly DiagnosticIssue[];
  onIssueClick?: (issue: DiagnosticIssue) => void;
}

function IssuesView({ issues, onIssueClick }: IssuesViewProps) {
  if (issues.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={mergeClassNames(styles.emptyIcon, styles.successIcon)}>
          <UiIcon name="check" />
        </span>
        <div>
          <strong>Структурных ошибок не найдено</strong>
          <span>Соединения и параметры блоков готовы к расчёту.</span>
        </div>
      </div>
    );
  }

  return (
    <ul className={styles.issueList} aria-label="Обнаруженные проблемы">
      {issues.map((issue) => {
        const isClickable = Boolean(onIssueClick && issue.blockId);
        return (
          <li key={issue.id}>
            <button
              type="button"
              className={mergeClassNames(styles.issue, styles[`severity-${issue.severity}`])}
              onClick={() => onIssueClick?.(issue)}
              disabled={!isClickable}
              title={isClickable ? "Показать блок на схеме" : undefined}
            >
              <span className={styles.issueMark} aria-hidden="true">
                <UiIcon name={issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : "info"} />
              </span>
              <span className={styles.issueCopy}>
                <span className={styles.issueTitle}>{issue.title}</span>
                {issue.message && <span className={styles.issueMessage}>{issue.message}</span>}
              </span>
              {(issue.blockLabel || issue.blockId) && (
                <span className={styles.blockRef}>{issue.blockLabel ?? issue.blockId}</span>
              )}
              {isClickable && <UiIcon name="chevron" className={styles.issueChevron} />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface ProgressViewProps {
  items: readonly DiagnosticProgressItem[];
  state: DiagnosticsRunState;
}

function ProgressView({ items, state }: ProgressViewProps) {
  if (items.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}><UiIcon name="activity" /></span>
        <div>
          <strong>{state === "idle" ? "Расчёт ещё не запущен" : "Нет данных о ходе расчёта"}</strong>
          <span>Этапы проверки появятся здесь после запуска модели.</span>
        </div>
      </div>
    );
  }

  return (
    <ol className={styles.progressList} aria-label="Этапы расчёта">
      {items.map((item) => (
        <li key={item.id} className={mergeClassNames(styles.progressItem, styles[`progress-${item.status}`])}>
          <span className={styles.progressMark} aria-hidden="true">
            {item.status === "done" ? <UiIcon name="check" /> : item.status === "error" ? <UiIcon name="error" /> : ""}
          </span>
          <span className={styles.progressCopy}>
            <strong>{item.label}</strong>
            {item.detail && <span>{item.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

