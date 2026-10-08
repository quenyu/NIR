import { useEffect, useState } from "react";
import {
  deleteServerProject,
  listServerProjects,
  type ServerProjectSummary,
} from "../api/projects";
import { UiIcon } from "./UiIcon";
import { useDialogFocus } from "../hooks/useDialogFocus";

interface ServerProjectsModalProps {
  open: boolean;
  currentProjectId: string | null;
  isBusy: boolean;
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
  onOpen: (projectId: string) => Promise<void>;
  onCurrentDeleted: () => void;
}

export function ServerProjectsModal({
  open,
  currentProjectId,
  isBusy,
  onClose,
  onCreate,
  onOpen,
  onCurrentDeleted,
}: ServerProjectsModalProps) {
  const [projects, setProjects] = useState<ServerProjectSummary[]>([]);
  const [title, setTitle] = useState("Дипломная модель");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>(open, onClose);

  async function refresh() {
    setIsLoading(true);
    setError("");
    try {
      setProjects(await listServerProjects());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить проекты.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  if (!open) return null;

  async function createProject() {
    if (!title.trim()) {
      setError("Введите название проекта.");
      return;
    }
    try {
      await onCreate(title.trim());
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Не удалось создать проект.");
    }
  }

  async function removeProject(projectId: string) {
    try {
      await deleteServerProject(projectId);
      if (projectId === currentProjectId) onCurrentDeleted();
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Не удалось удалить проект.");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section ref={dialogRef} className="server-projects-modal" role="dialog" aria-modal="true" aria-labelledby="server-projects-title" tabIndex={-1} onClick={(event) => event.stopPropagation()} data-testid="server-projects-modal">
        <header className="parameter-modal__header">
          <div>
            <span className="panel-kicker">Серверное хранилище</span>
            <h2 id="server-projects-title">Проекты Control Lab</h2>
          </div>
          <button type="button" className="btn" onClick={onClose}><UiIcon name="close" />Закрыть</button>
        </header>

        <div className="server-project-create">
          <label className="tool-input">
            <span>Название нового проекта</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void createProject()} disabled={isBusy}>
            <UiIcon name="save" />Создать на сервере
          </button>
        </div>

        {error && <p className="parameter-warning">{error}</p>}
        {isLoading ? (
          <p className="server-project-empty">Загружаю список проектов…</p>
        ) : projects.length === 0 ? (
          <p className="server-project-empty">На сервере пока нет сохранённых проектов.</p>
        ) : (
          <div className="server-project-list">
            {projects.map((project) => (
              <article key={project.id} className={project.id === currentProjectId ? "is-current" : ""}>
                <div>
                  <strong>{project.title}</strong>
                  <span>v{project.version} · {project.block_count} блоков</span>
                  <small>{new Date(project.updated_at).toLocaleString("ru-RU")}</small>
                </div>
                <div>
                  <button type="button" className="btn btn-secondary" onClick={() => void onOpen(project.id)} disabled={isBusy}>Открыть</button>
                  <button type="button" className="btn btn-danger-soft" onClick={() => void removeProject(project.id)} disabled={isBusy}>Удалить</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
