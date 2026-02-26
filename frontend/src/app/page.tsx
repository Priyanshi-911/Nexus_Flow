"use client";

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useContext,
} from "react";
import ReactFlow, {
  Controls,
  MiniMap,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  ReactFlowProvider,
  Node,
  useReactFlow,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { Toaster, toast } from "sonner";
import { io } from "socket.io-client";

import {
  Save,
  Play,
  Layers,
  Plus,
  Search,
  Loader2,
  Settings,
  LayoutGrid,
  LayoutList,
  Clock,
  GalleryHorizontalEnd,
} from "lucide-react";

import NexusNode from "@/components/flow/NexusNode";
import PropertiesPanel from "@/components/PropertiesPanel";
import ContextMenu from "@/components/flow/ContextMenu";
import LiveLogs from "@/components/LiveLogs";
import SettingsModal from "@/components/SettingsModal";
import ActiveSchedulesModal from "@/components/ActiveSchedulesModal";
import WorkflowGalleryModal from "@/components/WorkflowGalleryModal";
import DepositModal from "@/components/DepositModal"; // 🟢 NEW: Import Deposit Modal
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useDeployment } from "@/hooks/useDeployment";
import { NODE_TYPES, CATEGORY_COLORS } from "@/lib/nodeConfig";
import { FlowContext } from "@/components/flow/FlowContext";

// --- SOCKET CONNECTION ---
const socket = io("http://localhost:3001");

const nodeTypes = { nexusNode: NexusNode };

const INITIAL_NODES: Node[] = [
  {
    id: "1",
    type: "nexusNode",
    position: { x: 100, y: 100 },
    data: {
      type: "webhook",
      label: "TRIG-01",
      config: { description: "Webhook In" },
    },
  },
];

const CATEGORY_HEX: Record<string, string> = {
  trigger: "#f59e0b",
  web3: "#3b82f6",
  data: "#10b981",
  logic: "#64748b",
  notify: "#f43f5e",
  ops: "#3b82f6",
  ai: "#C026D3",
};

export default function NexusFlowPage() {
  const [isCompact, setIsCompact] = useState(true);

  return (
    <ReactFlowProvider>
      <FlowContext.Provider
        value={{ isCompact, toggleCompact: () => setIsCompact(!isCompact) }}
      >
        <NexusCanvas />
      </FlowContext.Provider>
      <Toaster richColors position="bottom-right" closeButton />
    </ReactFlowProvider>
  );
}

function NexusCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { screenToFlowPosition } = useReactFlow();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [menu, setMenu] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSchedulesOpen, setIsSchedulesOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  // 🟢 NEW: Deposit Modal State
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositData, setDepositData] = useState<any>(null);

  const [globalSettings, setGlobalSettings] = useState({
    name: "My Workflow",
    spreadsheetId: "",
  });

  // Track active execution
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { deploy, hotReload, runNow, isDeploying } = useDeployment();
  const { takeSnapshot, undo, redo } = useUndoRedo(nodes, edges);

  const [defaultEdgeType, setDefaultEdgeType] = useState<any>("smoothstep");
  const [defaultEdgePattern, setDefaultEdgePattern] = useState<any>("solid");

  const { isCompact, toggleCompact } = useContext(FlowContext);

  const handleSaveWorkflow = async () => {
    try {
      if (!globalSettings.name) {
        toast.error("Please set a workflow name before saving.");
        return;
      }

      const payload = {
        name: globalSettings.name,
        nodes,
        edges,
        globalSettings,
        workflowId: activeJobId,
      };

      const response = await fetch("http://localhost:3001/workflow-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to save workflow.");
      }

      const version = data.workflow?.version;
      toast.success("Workflow saved!", {
        description: version ? `Version ${version} stored.` : undefined,
      });
    } catch (err: any) {
      console.error("Save workflow failed:", err);
      toast.error("Failed to save workflow", {
        description: err.message || "Unknown error.",
      });
    }
  };

  const handleLoadWorkflow = async (nameOverride?: string) => {
    try {
      const targetName = nameOverride || globalSettings.name;
      if (!targetName) {
        toast.error("Please set a workflow name before loading.");
        return;
      }

      const response = await fetch(
        `http://localhost:3001/workflow-state/${encodeURIComponent(
          targetName,
        )}`,
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to load workflow.");
      }

      const workflow = data.workflow;
      if (!workflow) {
        throw new Error("Invalid workflow payload from server.");
      }

      setNodes(workflow.nodes || []);
      setEdges(workflow.edges || []);
      setGlobalSettings((prev) => ({
        ...prev,
        ...(workflow.globalSettings || {}),
        name: workflow.name || targetName || prev.name,
      }));

      if (workflow.id) {
        setActiveJobId(workflow.id);
        socket.emit("subscribe_job", workflow.id);
      }

      toast.success("Workflow loaded!");
    } catch (err: any) {
      console.error("Load workflow failed:", err);
      toast.error("Failed to load workflow", {
        description: err.message || "Unknown error.",
      });
    }
  };

  // --- THE AUTO-SAVE / HOT RELOAD HOOK ---
  useEffect(() => {
    if (activeJobId && hotReload) {
      const timeoutId = setTimeout(() => {
        console.log("🔄 Silently hot-reloading active workflow...");
        hotReload(globalSettings.name, globalSettings, activeJobId);
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [nodes, edges, globalSettings, activeJobId, hotReload]);

  // --- 1. REAL-TIME EXECUTION LISTENER ---
  useEffect(() => {
    socket.on("workflow_update", (event) => {
      const { type, nodeId, result, error, jobId, workflowId } = event as any;

      if (type === "workflow_run_started") {
        setNodes((nds) =>
          nds.map((n) => ({
            ...n,
            data: { ...n.data, executionData: null },
          })),
        );
        setEdges((eds) =>
          eds.map((e) => ({
            ...e,
            animated: false,
            style: {
              ...e.style,
              stroke: "#6366f1",
              strokeWidth: 2,
              strokeDasharray: "0",
            },
          })),
        );
        return;
      }

      // --- 🟢 NEW: INTERCEPT ACTIONABLE ERRORS BEFORE UPDATING NODES ---
      if (
        type === "node_failed" &&
        error &&
        typeof error === "string" &&
        error.startsWith("[ACTION_REQUIRED]")
      ) {
        try {
          const payloadStr = error.replace("[ACTION_REQUIRED] ", "");
          const payload = JSON.parse(payloadStr);

          if (payload.code === "DEPOSIT_REQUIRED") {
            // Attach workflow + job identifiers so we can resume correctly
            const extendedPayload = {
              ...payload,
              workflowId: payload.workflowId || workflowId || activeJobId,
              jobId: jobId || activeJobId,
            };

            setDepositData(extendedPayload);
            setIsDepositModalOpen(true);
          }
        } catch (e) {
          console.error("Failed to parse actionable error payload");
        }
      }
      // -----------------------------------------------------------------

      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            if (type === "node_started") {
              return {
                ...node,
                data: { ...node.data, executionData: { status: "running" } },
              };
            }
            if (type === "node_completed") {
              return {
                ...node,
                data: {
                  ...node.data,
                  executionData: { status: "success", result },
                },
              };
            }
            if (type === "node_failed") {
              // Clean up the error message for the UI if it's an actionable error
              const displayError =
                typeof error === "string" &&
                error.startsWith("[ACTION_REQUIRED]")
                  ? "Insufficient Funds (See popup)"
                  : error;

              return {
                ...node,
                data: {
                  ...node.data,
                  executionData: { status: "failed", error: displayError },
                },
              };
            }
          }
          return node;
        }),
      );

      setEdges((eds) =>
        eds.map((edge) => {
          if (type === "node_started" && edge.target === nodeId) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#fbbf24",
                strokeWidth: 2,
                strokeDasharray: "5,5",
              },
            };
          }
          if (type === "node_completed" && edge.target === nodeId) {
            return {
              ...edge,
              animated: false,
              style: {
                ...edge.style,
                stroke: "#10b981",
                strokeWidth: 3,
                strokeDasharray: "0",
              },
            };
          }
          if (type === "node_failed" && edge.target === nodeId) {
            return {
              ...edge,
              animated: false,
              style: {
                ...edge.style,
                stroke: "#ef4444",
                strokeWidth: 3,
                strokeDasharray: "0",
              },
            };
          }
          return edge;
        }),
      );
    });

    return () => {
      socket.off("workflow_update");
    };
  }, [setEdges, setNodes, activeJobId]);

  // Undo/Redo Logic
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const state = undo(nodes, edges);
        if (state) {
          setNodes(state.nodes);
          setEdges(state.edges);
        }
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        const state = redo(nodes, edges);
        if (state) {
          setNodes(state.nodes);
          setEdges(state.edges);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, nodes, edges, setNodes, setEdges]);

  // --- 2. DEPLOY HANDLER ---
  const handleDeploy = async () => {
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        animated: false,
        style: {
          ...e.style,
          stroke: "#6366f1",
          strokeWidth: 2,
          strokeDasharray: "0",
        },
      })),
    );
    setNodes((nds) =>
      nds.map((n) => ({ ...n, data: { ...n.data, executionData: null } })),
    );

    const promise = deploy(globalSettings.name, globalSettings, activeJobId);
    const result = await promise;

    if (result.success) {
      toast.success("Deployment Successful!", {
        description: "Your agent is active and listening for events.",
        duration: 4000,
      });

      const returnedJobId = result.jobId || (result.data && result.data.jobId);

      if (returnedJobId) {
        setActiveJobId(returnedJobId);
        socket.emit("subscribe_job", returnedJobId);
        console.log(`🔌 Subscribed to WebSocket room: ${returnedJobId}`);
        toast.info("Watching execution...", { duration: 2000 });
      }
    } else {
      toast.error("Deployment Failed", {
        description: result.error || "An unknown error occurred.",
        duration: 5000,
      });
    }
  };

  // --- 3. RUN NOW HANDLER ---
  const handleRunNow = async () => {
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        animated: false,
        style: {
          ...e.style,
          stroke: "#6366f1",
          strokeWidth: 2,
          strokeDasharray: "0",
        },
      })),
    );
    setNodes((nds) =>
      nds.map((n) => ({ ...n, data: { ...n.data, executionData: null } })),
    );

    const result = await runNow(globalSettings.name, globalSettings);
    if (result.success) {
      toast.success("Test Run Started!", { duration: 2000 });
      if (result.jobId) {
        setActiveJobId(result.jobId);
        socket.emit("subscribe_job", result.jobId);
      }
    } else {
      toast.error("Test Run Failed", { description: result.error });
    }
  };

  const onPaneClick = useCallback(() => {
    setMenu(null);
    setSelectedNodeId(null);
  }, []);

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  };

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      takeSnapshot(nodes, edges);
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            type: defaultEdgeType,
            style: {
              stroke: "#6366f1",
              strokeWidth: 2,
              strokeDasharray:
                defaultEdgePattern === "dashed"
                  ? "5,5"
                  : defaultEdgePattern === "dotted"
                    ? "2,2"
                    : "0",
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
          },
          eds,
        ),
      );
    },
    [setEdges, defaultEdgeType, defaultEdgePattern, takeSnapshot, nodes, edges],
  );

  const onDragStart = (event: React.DragEvent, type: string) => {
    event.dataTransfer.setData("application/reactflow", type);
    event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type) return;

      takeSnapshot(nodes, edges);
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `node_${Date.now()}`,
        type: "nexusNode",
        position: { x: position.x - 120, y: position.y - 40 },
        data: {
          type,
          label: `NODE-${nodes.length + 1}`,
          config: {},
        },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [nodes, setNodes, screenToFlowPosition, takeSnapshot, edges],
  );

  const onAddNode = (type: string) => {
    takeSnapshot(nodes, edges);
    const wrapper = reactFlowWrapper.current?.getBoundingClientRect();
    if (wrapper) {
      const centerX = wrapper.left + wrapper.width / 2;
      const centerY = wrapper.top + wrapper.height / 2;
      const position = screenToFlowPosition({ x: centerX, y: centerY });
      const snappedX = Math.round(position.x / 20) * 20;
      const snappedY = Math.round(position.y / 20) * 20;

      const newNode: Node = {
        id: `node_${Date.now()}`,
        type: "nexusNode",
        position: { x: snappedX, y: snappedY },
        data: {
          type,
          label: `NODE-${nodes.length + 1}`,
          config: {},
        },
      };
      setNodes((nds) => nds.concat(newNode));
    }
  };

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const pane = reactFlowWrapper.current?.getBoundingClientRect();
      if (pane) {
        setMenu({
          id: node.id,
          type: "node",
          top: event.clientY - pane.top,
          left: event.clientX - pane.left,
        });
      }
    },
    [],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      const pane = reactFlowWrapper.current?.getBoundingClientRect();
      if (pane) {
        setMenu({
          id: edge.id,
          type: "edge",
          data: { type: edge.type, style: edge.style },
          top: event.clientY - pane.top,
          left: event.clientX - pane.left,
        });
      }
    },
    [],
  );

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const pane = reactFlowWrapper.current?.getBoundingClientRect();
    if (pane) {
      setMenu({
        id: "pane-menu",
        type: "pane",
        top: event.clientY - pane.top,
        left: event.clientX - pane.left,
      });
    }
  }, []);

  const duplicateNode = (id: string) => {
    takeSnapshot(nodes, edges);
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const position = { x: node.position.x + 40, y: node.position.y + 40 };
    const newNode = {
      ...node,
      id: `${node.data.type}_${Date.now()}`,
      position,
      data: { ...node.data, label: `${node.data.label} (Copy)` },
      selected: true,
    };
    setNodes((nds) => nds.concat(newNode));
  };

  const updateNodeData = (id: string, newData: any) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              config: { ...node.data.config, ...newData },
            },
          };
        }
        return node;
      }),
    );
  };

  const updateEdgeStyle = (edgeId: string, type: any, pattern: any) => {
    takeSnapshot(nodes, edges);
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id === edgeId) {
          return {
            ...e,
            type: type || e.type,
            style: {
              ...e.style,
              strokeDasharray:
                pattern === "dashed"
                  ? "5,5"
                  : pattern === "dotted"
                    ? "2,2"
                    : "0",
            },
          };
        }
        return e;
      }),
    );
    if (type) setDefaultEdgeType(type);
    if (pattern) setDefaultEdgePattern(pattern);
  };

  const updateGlobalDefaults = (type: any, pattern: any) => {
    if (type) setDefaultEdgeType(type);
    if (pattern) setDefaultEdgePattern(pattern);
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans overflow-hidden">
      {/* LEFT SIDEBAR */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col z-20 shadow-sm">
        <div className="p-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-indigo-200 shadow-lg shrink-0">
            <Layers size={20} />
          </div>
          <div>
            <h1 className="font-bold text-lg text-slate-800 tracking-tight">
              Nexus Flow
            </h1>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
              Orchestration
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-4 pb-0">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-700"
            />
            <input
              type="text"
              placeholder="Search nodes..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-gray-700"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Node Palette */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {["trigger", "web3", "data", "logic", "notify", "ops", "ai"].map(
            (cat) => {
              const categoryNodes = Object.entries(NODE_TYPES).filter(
                ([type, config]) =>
                  config.category === cat &&
                  config.label.toLowerCase().includes(searchTerm.toLowerCase()),
              );

              if (categoryNodes.length === 0) return null;

              return (
                <div
                  key={cat}
                  className="animate-in fade-in slide-in-from-left-4 duration-300"
                >
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-2">
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </h3>
                  <div className="space-y-2">
                    {categoryNodes.map(([type, config]) => (
                      <div
                        key={type}
                        onClick={() => onAddNode(type)}
                        className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all group active:scale-95"
                        draggable
                        onDragStart={(event) => onDragStart(event, type)}
                      >
                        <div
                          className={`p-2 rounded-lg ${CATEGORY_COLORS[cat].bg}`}
                        >
                          {React.createElement(config.icon, {
                            size: 16,
                            className: CATEGORY_COLORS[cat].text,
                          })}
                        </div>
                        <span className="text-sm font-medium text-slate-600 group-hover:text-indigo-600">
                          {config.label}
                        </span>
                        <Plus
                          size={14}
                          className="ml-auto text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            },
          )}
        </div>
      </div>

      {/* MAIN CANVAS */}
      <div className="flex-1 flex flex-col relative h-full">
        {/* Header */}
        <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 z-10 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-slate-400 text-sm">
              Workflow /{" "}
              <span className="text-slate-800 font-semibold">
                {globalSettings.name}
              </span>
            </span>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors"
            >
              <Settings size={14} />
            </button>
          </div>

          <div className="flex gap-3 relative">
            {/* View Toggle Buttons */}
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 mr-2">
              <button
                onClick={() => isCompact && toggleCompact()}
                className={`p-1.5 rounded-md transition-all ${
                  !isCompact
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                }`}
                title="Card View"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => !isCompact && toggleCompact()}
                className={`p-1.5 rounded-md transition-all ${
                  isCompact
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                }`}
                title="Icon View"
              >
                <LayoutList size={16} />
              </button>
            </div>

            {/* Schedules Manager Button */}
            <button
              onClick={() => setIsSchedulesOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-white border border-slate-200 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors"
            >
              <Clock size={16} className="text-indigo-500" /> Schedules
            </button>

            {/* Workflow Gallery Button */}
            <button
              onClick={() => setIsGalleryOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-white border border-slate-200 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors"
            >
              <GalleryHorizontalEnd
                size={16}
                className="text-indigo-500"
              />{" "}
              Gallery
            </button>

            {/* Save Workflow Button */}
            <button
              onClick={handleSaveWorkflow}
              className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-white border border-slate-200 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors"
            >
              <Save size={16} className="text-indigo-500" /> Save
            </button>

            {/* Run Now Button */}
            <button
              className="flex items-center gap-2 px-4 py-2 text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg text-sm font-bold hover:bg-indigo-100 transition-colors"
              onClick={handleRunNow}
              disabled={isDeploying}
            >
              <Play size={16} /> Run Now
            </button>

            {/* Deploy Button */}
            <button
              className={`flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all transform hover:scale-105 ${
                isDeploying ? "opacity-70 cursor-wait" : ""
              }`}
              onClick={handleDeploy}
              disabled={isDeploying}
            >
              {isDeploying ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {isDeploying ? "Deploying..." : "Deploy"}
            </button>
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 relative bg-slate-50" ref={reactFlowWrapper}>
          <ReactFlow
            ref={ref}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onPaneClick={onPaneClick}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid={true}
            snapGrid={[20, 20]}
          >
            <Background gap={20} color="#cbd5e1" />
            <Controls className="!bg-white !border-gray-200 !shadow-lg !rounded-lg" />

            <MiniMap
              className="!bg-white !border-gray-200 !shadow-lg !shadow-slate-400 !rounded-lg"
              zoomable
              pannable
              nodeColor={(n) => {
                const type = n.data?.type;
                const config = NODE_TYPES[type];
                const category = config?.category;
                return category ? CATEGORY_HEX[category] : "#e2e8f0";
              }}
            />

            {menu && (
              <ContextMenu
                onClick={onPaneClick}
                {...menu}
                onClose={() => setMenu(null)}
                onDuplicate={duplicateNode}
                onEdgeUpdate={updateEdgeStyle}
                onGlobalUpdate={updateGlobalDefaults}
                globalDefaults={{
                  type: defaultEdgeType,
                  pattern: defaultEdgePattern,
                }}
              />
            )}
          </ReactFlow>
        </div>
      </div>

      {/* RIGHT PROPERTIES PANEL */}
      {selectedNodeId && nodes.find((n) => n.id === selectedNodeId) && (
        <PropertiesPanel
          selectedNode={nodes.find((n) => n.id === selectedNodeId)}
          updateData={updateNodeData}
          onClose={() => setSelectedNodeId(null)}
          globalSettings={globalSettings}
          nodes={nodes}
        />
      )}

      {/* 🟢 DEPOSIT MODAL */}
      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
        depositData={depositData}
        onResume={async (workflowId: string, pausedJobId: string) => {
          try {
            const response = await fetch("http://localhost:3001/resume-workflow", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ workflowId, jobId: pausedJobId }),
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
              console.error("Failed to resume workflow:", data.error);
              toast.error("Failed to resume workflow", {
                description: data.error || "Unknown resume error.",
              });
              return;
            }

            const newJobId = data.jobId;
            setActiveJobId(newJobId);
            socket.emit("subscribe_job", newJobId);
            console.log(`🔁 Resumed workflow. Subscribed to room: ${newJobId}`);
            toast.success("Workflow resumed!", { duration: 3000 });
          } catch (err: any) {
            console.error("Resume workflow request failed:", err);
            toast.error("Failed to resume workflow", {
              description: err.message || "Network error.",
            });
          }
        }}
      />

      {/* ACTIVE SCHEDULES MODAL */}
      <ActiveSchedulesModal
        isOpen={isSchedulesOpen}
        onClose={() => setIsSchedulesOpen(false)}
      />

      {/* WORKFLOW GALLERY MODAL */}
      <WorkflowGalleryModal
        isOpen={isGalleryOpen}
        onClose={() => setIsGalleryOpen(false)}
        onSelectWorkflow={async (name: string) => {
          await handleLoadWorkflow(name);
        }}
      />

      {/* SETTINGS MODAL */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialData={globalSettings}
        onSave={(data: any) => {
          setGlobalSettings(data);
          setIsSettingsOpen(false);
        }}
      />
    </div>
  );
}
