import React, { useEffect, useState } from "react";
import { X, FolderKanban, Loader2, Clock3, Trash2 } from "lucide-react";
import { toast } from "sonner";

type WorkflowMeta = {
  id: string;
  name: string;
  createdAt?: string;
};

export default function WorkflowGalleryModal({
  isOpen,
  onClose,
  onSelectWorkflow,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectWorkflow: (name: string) => void | Promise<void>;
}) {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchWorkflows();
    }
  }, [isOpen]);

  const fetchWorkflows = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("http://localhost:3001/workflow-states");
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to fetch workflows.");
      }

      setWorkflows(data.workflows || []);
    } catch (err: any) {
      console.error("Failed to load workflows:", err);
      toast.error("Failed to load workflows", {
        description: err.message || "Unknown error.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!name) return;
    try {
      setDeletingName(name);
      const res = await fetch(
        `http://localhost:3001/workflow-state/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete workflow.");
      }

      setWorkflows((prev) => prev.filter((wf) => wf.name !== name));
      toast.success("Workflow deleted");
    } catch (err: any) {
      console.error("Failed to delete workflow:", err);
      toast.error("Failed to delete workflow", {
        description: err.message || "Unknown error.",
      });
    } finally {
      setDeletingName(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-[640px] max-w-[95vw] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 border border-slate-200/60">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
              <FolderKanban size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 tracking-tight">
                Workflow Gallery
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Browse and load saved workflow configurations
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto max-h-[65vh] bg-white">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Loader2 size={24} className="animate-spin text-indigo-500 mb-3" />
              <span className="text-sm">Loading workflows...</span>
            </div>
          ) : workflows.length === 0 ? (
            <div className="flex flex-col items-center text-center py-12 px-4 border border-dashed border-slate-200 rounded-2xl bg-slate-50">
              <div className="w-12 h-12 bg-white text-slate-300 rounded-xl flex items-center justify-center mb-3 shadow-sm border border-slate-100">
                <FolderKanban size={24} />
              </div>
              <h3 className="text-sm font-semibold text-slate-700">
                No saved workflows yet
              </h3>
              <p className="text-sm text-slate-500 mt-1 max-w-xs">
                Save a workflow from the canvas header to see it here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {workflows.map((wf) => (
                <button
                  key={`${wf.id}-${wf.name}`}
                  onClick={async () => {
                    await onSelectWorkflow(wf.name);
                    onClose();
                  }}
                  className="w-full text-left group flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-indigo-300 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] transition-all duration-200"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 border border-indigo-100">
                      <FolderKanban size={18} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {wf.name}
                      </span>
                      {wf.id && (
                        <span className="text-[11px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded mt-0.5 truncate max-w-[220px]">
                          {wf.id}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    {wf.createdAt && (
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Clock3 size={12} className="text-slate-400" />
                        <span>
                          {new Date(wf.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleDelete(wf.name);
                      }}
                      className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors"
                      disabled={deletingName === wf.name}
                      title="Delete workflow"
                    >
                      {deletingName === wf.name ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

