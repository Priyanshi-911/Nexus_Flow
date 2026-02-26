import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Settings,
  Braces,
  ChevronRight,
  Activity,
  Database,
  Cpu,
  Search,
  ChevronDown,
  Check,
  Coins,
  Lock,
  Plus,
  Minus,
  Divide,
  Percent,
  Send,
  FileText,
  Trash2,
  Type,
  ArrowRightLeft,
  Hash,
  Clock,
  CalendarClock,
  List,
  AlignLeft,
  Zap,
  MessageCircle,
  Ruler,
  Calendar as CalendarIcon,
} from "lucide-react";
import { NODE_TYPES, CATEGORY_COLORS } from "@/lib/nodeConfig";
import LogicBuilder from "./LogicBuilder";

const getSelectOptionIcon = (opt: string, disabled: boolean = false) => {
  const tokenIcons: Record<string, string> = {
    ETH: "https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=025",
    USDC: "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=025",
    WETH: "https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=025",
    UNI: "https://cryptologos.cc/logos/uniswap-uni-logo.svg?v=025",
    LINK: "https://cryptologos.cc/logos/chainlink-link-logo.svg?v=025",
  };
  const opacityClass = disabled ? "opacity-40 grayscale" : "";
  if (tokenIcons[opt])
    return (
      <img
        src={tokenIcons[opt]}
        alt={opt}
        className={`rounded-full shadow-sm ${opacityClass}`}
        style={{ width: "18px", height: "18px" }}
      />
    );
  const IconProps = {
    size: 16,
    className: disabled ? "text-slate-300" : "text-indigo-500",
  };
  switch (opt?.toLowerCase()) {
    case "custom":
      return <Coins {...IconProps} />;
    case "add":
      return <Plus {...IconProps} />;
    case "subtract":
      return <Minus {...IconProps} />;
    case "multiply":
      return <X {...IconProps} />;
    case "divide":
      return <Divide {...IconProps} />;
    case "percent":
      return <Percent {...IconProps} />;
    case "get":
      return <Search {...IconProps} />;
    case "post":
      return <Send {...IconProps} />;
    case "put":
      return <FileText {...IconProps} />;
    case "delete":
      return <Trash2 {...IconProps} />;
    case "upper":
    case "lower":
      return <Type {...IconProps} />;
    case "replace":
      return <ArrowRightLeft {...IconProps} />;
    case "parse_number":
      return <Hash {...IconProps} />;
    case "interval":
      return <Clock {...IconProps} />;
    case "cron":
      return <CalendarClock {...IconProps} />;
    case "bullet points":
      return <List {...IconProps} />;
    case "paragraph":
      return <AlignLeft {...IconProps} />;
    case "tldr":
      return <Zap {...IconProps} />;
    case "tweet":
      return <MessageCircle {...IconProps} />;
    case "short":
    case "medium":
    case "long":
      return <Ruler {...IconProps} />;
    case "true":
    case "false":
      return <Check {...IconProps} />;
    default:
      return (
        <div
          className={`w-1.5 h-1.5 rounded-full ml-1 ${disabled ? "bg-slate-200" : "bg-indigo-300"}`}
        />
      );
  }
};

const AddressAvatar = ({
  seed,
  disabled,
}: {
  seed: string;
  disabled: boolean;
}) => {
  if (!seed)
    return (
      <div
        className={`w-5 h-5 rounded-full bg-slate-100 border border-slate-200 ${disabled ? "opacity-50" : ""}`}
      />
    );
  if (seed.includes("{{"))
    return (
      <div
        className={`w-5 h-5 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-500 ${disabled ? "opacity-50 grayscale" : ""}`}
      >
        <Braces size={10} strokeWidth={3} />
      </div>
    );
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return (
    <div
      className={`w-5 h-5 rounded-full shadow-inner ${disabled ? "opacity-40 grayscale" : ""}`}
      style={{
        background: `linear-gradient(135deg, hsl(${Math.abs(hash) % 360}, 80%, 65%), hsl(${Math.abs(hash * 13) % 360}, 80%, 75%))`,
      }}
    />
  );
};

export default function PropertiesPanel({
  selectedNode,
  updateData,
  onClose,
  nodes,
}: any) {
  const type = selectedNode.data.type;
  const config = NODE_TYPES[type] || {};
  const colors = CATEGORY_COLORS[config.category] || CATEGORY_COLORS.logic;
  const currentData = selectedNode.data.config || {};
  const [pickerConfig, setPickerConfig] = useState<any>(null);
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const [selectSearch, setSelectSearch] = useState("");
  const inputRefs = useRef<Record<string, any>>({});

  useEffect(() => {
    const h = (e: any) =>
      e.key === "Escape" && (setPickerConfig(null), setOpenSelect(null));
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const handleChange = (f: string, v: any) =>
    updateData(selectedNode.id, { [f]: v });

  const isInputDisabled = (n: string) =>
    (n === "customTokenIn" && currentData["tokenIn"] !== "Custom") ||
    (n === "customTokenOut" && currentData["tokenOut"] !== "Custom") ||
    (n === "customToken" && currentData["token"] !== "Custom") ||
    (n === "intervalMinutes" && currentData["scheduleType"] !== "interval") ||
    (n === "cronTime" && currentData["scheduleType"] !== "cron");

  const handleOpenStandardPicker = (f: string) => {
    if (isInputDisabled(f)) return;
    const el = inputRefs.current[f];
    const pos = el?.selectionStart || (currentData[f] || "").length;
    setPickerConfig({
      onInsert: (v: string, n?: string) => {
        const fmt = n ? `{{${n}.${v}}}` : `{{${v}}}`;
        const cur = currentData[f] || "";
        handleChange(f, `${cur.slice(0, pos)}${fmt}${cur.slice(pos)}`);
        setPickerConfig(null);
      },
    });
  };

  const getAvailableVariables = () => {
    const g: any = {};
    nodes.forEach((n: any) => {
      if (n.id === selectedNode.id) return;
      const cfg = NODE_TYPES[n.data.type];
      if (cfg?.outputs) {
        if (!g[n.id])
          g[n.id] = {
            id: n.id,
            label: n.data.label || cfg.label,
            variables: [],
          };
        cfg.outputs.forEach((o: any) =>
          g[n.id].variables.push({ name: o.name, nodeId: n.id, desc: o.desc }),
        );
      }
    });
    return Object.values(g);
  };

  const timeValue = currentData["cronTime"] || "12:00 PM";
  const timeMatch = timeValue.match(/(\d+):(\d+) (AM|PM)/);
  const hour = timeMatch ? timeMatch[1] : "12";
  const minute = timeMatch ? timeMatch[2] : "00";
  const period = timeMatch ? timeMatch[3] : "PM";

  const handleTimeChange = (
    part: "hour" | "minute" | "period",
    value: string,
  ) => {
    const newHour = part === "hour" ? value.padStart(2, "0") : hour;
    const newMinute = part === "minute" ? value.padStart(2, "0") : minute;
    const newPeriod = part === "period" ? value : period;
    handleChange("cronTime", `${newHour}:${newMinute} ${newPeriod}`);
  };

  return (
    <div className="w-96 bg-white border-l border-gray-200 h-full flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.05)] z-30 relative overflow-hidden animate-in slide-in-from-right duration-300">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4">
          <div className={`p-2.5 rounded-xl shadow-sm ${colors.bg}`}>
            {React.createElement(config.icon, {
              size: 20,
              className: colors.text,
            })}
          </div>
          <div>
            <h2 className="font-bold text-slate-900 tracking-tight">
              {config.label}
            </h2>
            <p className="text-[10px] text-slate-400 font-mono font-bold uppercase">
              {selectedNode.data.label}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-slate-600 transition-all shadow-sm"
        >
          <X size={20} />
        </button>
      </div>
      <div className="p-6 overflow-y-auto flex-1 space-y-8 pb-32 custom-scrollbar">
        <div className="space-y-6">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 px-1">
            <Settings size={12} /> Configuration
          </h3>
          {config.inputs?.map((input: any) => {
            const isDisabled = isInputDisabled(input.name);
            const isAddr = ["address", "recipient", "contract"].some((k) =>
              input.name.toLowerCase().includes(k),
            );

            return (
              <div
                key={input.name}
                className="space-y-2 relative group animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="flex justify-between items-center px-1">
                  <label
                    className={`text-xs font-black uppercase tracking-wider ${isDisabled ? "text-slate-300" : "text-slate-600"}`}
                  >
                    {input.label}
                  </label>
                  {isDisabled && <Lock size={10} className="text-slate-300" />}
                </div>

                {input.type === "time-picker" ? (
                  <div
                    className={`flex gap-3 ${isDisabled ? "opacity-30 pointer-events-none" : "animate-in fade-in zoom-in-95 duration-200"}`}
                  >
                    <div className="flex-1 relative group/select">
                      <select
                        value={parseInt(hour).toString()}
                        onChange={(e) =>
                          handleTimeChange("hour", e.target.value)
                        }
                        className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl text-sm font-bold focus:border-indigo-500 hover:border-slate-200 outline-none appearance-none transition-all shadow-sm"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(
                          (h) => (
                            <option key={h} value={h}>
                              {h.toString().padStart(2, "0")}
                            </option>
                          ),
                        )}
                      </select>
                      <ChevronDown
                        size={14}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                    </div>
                    <div className="flex-1 relative group/select">
                      <select
                        value={minute}
                        onChange={(e) =>
                          handleTimeChange("minute", e.target.value)
                        }
                        className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl text-sm font-bold focus:border-indigo-500 hover:border-slate-200 outline-none appearance-none transition-all shadow-sm"
                      >
                        {Array.from({ length: 60 }, (_, i) =>
                          i.toString().padStart(2, "0"),
                        ).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={14}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                    </div>
                    <div className="flex-1 relative group/select">
                      <select
                        value={period}
                        onChange={(e) =>
                          handleTimeChange("period", e.target.value)
                        }
                        className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl text-sm font-bold focus:border-indigo-500 hover:border-slate-200 outline-none appearance-none transition-all shadow-sm"
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                      <ChevronDown
                        size={14}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                    </div>
                  </div>
                ) : input.type === "select" ? (
                  <div className="relative">
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => {
                        setOpenSelect(
                          openSelect === input.name ? null : input.name,
                        );
                        setSelectSearch("");
                      }}
                      className={`w-full px-4 py-3 rounded-2xl text-sm flex items-center justify-between border-2 transition-all ${isDisabled ? "bg-slate-50 border-slate-100 cursor-not-allowed" : openSelect === input.name ? "bg-white border-indigo-500 shadow-lg ring-4 ring-indigo-50" : "bg-white border-slate-100 hover:border-slate-200 hover:shadow-md"}`}
                    >
                      <div className="flex items-center gap-3">
                        {getSelectOptionIcon(
                          currentData[input.name] || "",
                          isDisabled,
                        )}
                        <span
                          className={`font-medium ${!currentData[input.name] ? "text-slate-400 italic" : "text-slate-800"}`}
                        >
                          {currentData[input.name] || "Select or type token..."}
                        </span>
                      </div>
                      <ChevronDown
                        size={16}
                        className={`transition-transform duration-300 ${openSelect === input.name ? "rotate-180 text-indigo-500" : "text-slate-400"}`}
                      />
                    </button>
                    {openSelect === input.name && (
                      <div className="absolute top-full left-0 mt-3 w-full bg-white border-2 border-slate-100 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-3 border-b-2 border-slate-50 flex items-center gap-3 bg-slate-50/50">
                          <Search size={14} className="text-slate-400" />
                          <input
                            autoFocus
                            className="w-full bg-transparent text-sm outline-none font-medium placeholder:text-slate-300"
                            placeholder="Search or type custom ID..."
                            value={selectSearch}
                            onChange={(e) => {
                              setSelectSearch(e.target.value);
                              handleChange(input.name, e.target.value);
                            }}
                          />
                        </div>
                        <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
                          {input.options
                            .filter((o: string) =>
                              o
                                .toLowerCase()
                                .includes(selectSearch.toLowerCase()),
                            )
                            .map((o: string) => (
                              <button
                                key={o}
                                className="w-full text-left px-4 py-3 text-sm hover:bg-indigo-50/50 rounded-xl flex items-center justify-between group transition-all"
                                onClick={() => {
                                  handleChange(input.name, o);
                                  setOpenSelect(null);
                                }}
                              >
                                <div className="flex items-center gap-3">
                                  {getSelectOptionIcon(o)}
                                  <span
                                    className={`font-semibold ${currentData[input.name] === o ? "text-indigo-600" : "text-slate-600 group-hover:text-indigo-500"}`}
                                  >
                                    {o}
                                  </span>
                                </div>
                                {currentData[input.name] === o && (
                                  <Check
                                    size={16}
                                    strokeWidth={2.5}
                                    className="text-indigo-600"
                                  />
                                )}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : input.type === "beautified-date" ? ( // NEW BEAUTIFIED DATE HANDLER
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-indigo-500">
                      <CalendarIcon size={18} />
                    </div>
                    <input
                      type="date"
                      className="w-full py-4 pl-12 pr-12 rounded-2xl text-sm font-bold border-2 border-slate-100 bg-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 focus:shadow-lg transition-all"
                      value={currentData[input.name] || ""}
                      onChange={(e) => handleChange(input.name, e.target.value)}
                    />
                    <button
                      onClick={() => handleOpenStandardPicker(input.name)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                    >
                      <Braces size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    {input.type === "textarea" ? (
                      <textarea
                        className="w-full p-4 rounded-2xl text-sm h-32 font-mono font-bold border-2 border-slate-100 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all resize-none shadow-sm"
                        value={currentData[input.name] || ""}
                        onChange={(e) =>
                          handleChange(input.name, e.target.value)
                        }
                        placeholder={input.placeholder || ""}
                      />
                    ) : (
                      <input
                        type={input.type}
                        className={`w-full py-3.5 px-4 rounded-2xl text-sm font-bold border-2 border-slate-100 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all shadow-sm ${isAddr ? "pl-12" : ""}`}
                        value={currentData[input.name] || ""}
                        onChange={(e) =>
                          handleChange(input.name, e.target.value)
                        }
                        placeholder={input.placeholder || ""}
                      />
                    )}
                    {isAddr && (
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                        <AddressAvatar
                          seed={currentData[input.name] || ""}
                          disabled={isDisabled}
                        />
                      </div>
                    )}
                    <button
                      onClick={() => handleOpenStandardPicker(input.name)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                    >
                      <Braces size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
