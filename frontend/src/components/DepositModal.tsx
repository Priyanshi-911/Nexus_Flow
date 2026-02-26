import React, { useEffect, useState } from "react";
import {
  Wallet,
  Loader2,
  X,
  AlertTriangle,
  ArrowDownToLine,
  Info,
} from "lucide-react";
import { parseAbi, parseUnits } from "viem";
import { toast } from "sonner";
import {
  useAccount,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

// Helper to shorten the Ethereum address
const truncateAddress = (address: string) => {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export default function DepositModal({
  isOpen,
  onClose,
  depositData,
  onResume,
}: any) {
  const { isConnected } = useAccount();

  // Wagmi hooks for sending transactions
  const { sendTransactionAsync, isPending: isSendingETH } =
    useSendTransaction();
  const { writeContractAsync, isPending: isWritingERC20 } = useWriteContract();

  // Track the deposit transaction hash until it's confirmed
  const [pendingHash, setPendingHash] = useState<`0x${string}` | null>(null);
  const [hasResumed, setHasResumed] = useState(false);
  const [amountInput, setAmountInput] = useState<string>("");
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState<string>("ETH");
  const [selectedIsNative, setSelectedIsNative] = useState<boolean>(true);
  const [selectedTokenAddress, setSelectedTokenAddress] = useState<
    string | null
  >(null);
  const [selectedDecimals, setSelectedDecimals] = useState<number>(18);

  const {
    isSuccess: isConfirmed,
    isLoading: isConfirming,
  } = useWaitForTransactionReceipt({
    hash: pendingHash ?? undefined,
  });

  const isProcessing = isSendingETH || isWritingERC20 || isConfirming;

  useEffect(() => {
    if (!depositData) return;

    // For manual deposits, default to ETH and allow switching
    if (depositData.code === "MANUAL_DEPOSIT") {
      setSelectedTokenSymbol("ETH");
      setSelectedIsNative(true);
      setSelectedTokenAddress(null);
      setSelectedDecimals(18);
    } else {
      // For DEPOSIT_REQUIRED flows, respect the token from backend
      setSelectedTokenSymbol(depositData.tokenSymbol);
      setSelectedIsNative(!!depositData.isNative);
      setSelectedTokenAddress(depositData.tokenAddress || null);
      setSelectedDecimals(
        typeof depositData.decimals === "number"
          ? depositData.decimals
          : 18,
      );
    }

    setAmountInput("");
  }, [depositData]);

  const handleSelectAsset = (symbol: "ETH" | "USDC") => {
    // Only allow asset switching for manual funding
    if (!depositData || depositData.code !== "MANUAL_DEPOSIT") return;

    if (symbol === "ETH") {
      setSelectedTokenSymbol("ETH");
      setSelectedIsNative(true);
      setSelectedTokenAddress(null);
      setSelectedDecimals(18);
    } else {
      // USDC on Sepolia (must match server/.env USDC_ADDRESS)
      setSelectedTokenSymbol("USDC");
      setSelectedIsNative(false);
      setSelectedTokenAddress(
        "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      );
      setSelectedDecimals(6);
    }
  };

  const handleDeposit = async () => {
    try {
      const decimals = selectedDecimals || 18;

      let amountWei: bigint;
      if (amountInput && amountInput.trim() !== "") {
        try {
          amountWei = parseUnits(amountInput.trim(), decimals);
        } catch (err: any) {
          toast.error("Invalid amount", {
            description:
              err?.message || "Please enter a valid numeric amount.",
          });
          return;
        }
      } else {
        amountWei = BigInt(depositData.missingAmountRaw);
      }

      let txHash;

      if (selectedIsNative) {
        // Native ETH Transfer using Wagmi
        txHash = await sendTransactionAsync({
          to: depositData.accountAddress as `0x${string}`,
          value: amountWei,
        });
      } else {
        // ERC-20 Transfer using Wagmi
        if (!selectedTokenAddress) {
          toast.error("Token address missing", {
            description:
              "Cannot send ERC-20 without a configured token address.",
          });
          return;
        }

        txHash = await writeContractAsync({
          address: selectedTokenAddress as `0x${string}`,
          abi: parseAbi(["function transfer(address to, uint256 amount)"]),
          functionName: "transfer",
          args: [
            depositData.accountAddress as `0x${string}`,
            amountWei,
          ],
        });
      }

      setPendingHash(txHash as `0x${string}`);
      setHasResumed(false);

      toast.success("Deposit submitted!", {
        description: `Waiting for confirmation... ${truncateAddress(txHash)}`,
        duration: 5000,
      });
    } catch (error: any) {
      console.error("Deposit Failed:", error);
      toast.error("Transaction Failed", {
        description:
          error.shortMessage || "The transaction was rejected or failed.",
      });
    }
  };

  // Auto-resume ONLY after the deposit transaction is confirmed on-chain
  useEffect(() => {
    if (!pendingHash || !isConfirmed) return;

    toast.success("Deposit confirmed!", {
      description: `Hash: ${truncateAddress(pendingHash)}`,
      duration: 5000,
    });

    // Close modal
    onClose();

    // Trigger resume once per confirmed deposit
    if (!hasResumed && onResume && depositData?.workflowId && depositData?.jobId) {
      setHasResumed(true);
      onResume(depositData.workflowId, depositData.jobId);
    }

    setPendingHash(null);
  }, [pendingHash, isConfirmed, onClose, onResume, depositData, hasResumed]);

  if (!isOpen || !depositData) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className="bg-white rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.2)] w-full max-w-[400px] overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Section */}
        <div className="pt-6 px-6 pb-4 relative flex flex-col items-center text-center">
          <button
            onClick={!isProcessing ? onClose : undefined}
            disabled={isProcessing}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50"
          >
            <X size={20} strokeWidth={2.5} />
          </button>

          <div className="w-14 h-14 bg-amber-50 border border-amber-100 text-amber-500 rounded-full flex items-center justify-center mb-4 shadow-sm">
            <AlertTriangle size={28} strokeWidth={2} />
          </div>

          <h2 className="text-xl font-bold text-slate-800 tracking-tight">
            Fund Your Account
          </h2>
          <p className="text-sm text-slate-500 mt-1.5 px-4">
            Your Smart Account requires more funds to execute this workflow
            automation.
          </p>
        </div>

        {/* Deposit Details Card */}
        <div className="px-6 pb-6">
          <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 mb-6">
            {/* Amount */}
            <div className="flex flex-col items-center justify-center mb-5 pb-5 border-b border-slate-200/80">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Amount to Deposit
              </span>
              {depositData?.code === "MANUAL_DEPOSIT" && (
                <div className="flex items-center justify-center gap-2 mt-2 mb-1">
                  <button
                    type="button"
                    onClick={() => handleSelectAsset("ETH")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                      selectedTokenSymbol === "ETH"
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-slate-600 border-slate-200"
                    }`}
                  >
                    ETH
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAsset("USDC")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                      selectedTokenSymbol === "USDC"
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-slate-600 border-slate-200"
                    }`}
                  >
                    USDC
                  </button>
                </div>
              )}
              <div className="flex flex-col items-center gap-2 w-full">
                <div className="flex items-baseline gap-1.5 text-slate-800">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="w-28 text-center text-3xl font-black tracking-tight bg-transparent border-b border-slate-300 focus:outline-none focus:border-indigo-500"
                    placeholder={
                      depositData.missingAmountFormatted ||
                      "0.0"
                    }
                  />
                  <span className="text-lg font-bold text-slate-500">
                    {selectedTokenSymbol}
                  </span>
                </div>
                {depositData.missingAmountFormatted && (
                  <span className="text-[11px] text-slate-400">
                    Suggested minimum:{" "}
                    {depositData.missingAmountFormatted}{" "}
                    {depositData.tokenSymbol}
                  </span>
                )}
              </div>
            </div>

            {/* Destination Address */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <ArrowDownToLine size={16} className="text-indigo-400" />
                <span className="font-medium">To Smart Account</span>
              </div>
              <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-md shadow-sm">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-xs font-mono font-bold text-slate-700">
                  {truncateAddress(depositData.accountAddress)}
                </span>
              </div>
            </div>
          </div>

          {/* Action Button Section */}
          <div className="space-y-3">
            {!isConnected ? (
              <div className="w-full flex justify-center [&>div]:w-full [&_button]:!w-full [&_button]:!justify-center">
                <ConnectButton />
              </div>
            ) : (
              <button
                onClick={handleDeposit}
                disabled={isProcessing}
                className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 shadow-sm
                  ${
                    isProcessing
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white hover:shadow-md hover:-translate-y-0.5"
                  }
                `}
              >
                {isProcessing ? (
                  <>
                    <Loader2
                      size={18}
                      className="animate-spin text-indigo-500"
                    />
                    <span className="text-slate-600">Confirm in Wallet...</span>
                  </>
                ) : (
                  <>
                    <Wallet size={18} />
                    Deposit {selectedTokenSymbol}
                  </>
                )}
              </button>
            )}

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 font-medium">
              <Info size={12} />
              <span>Network fees may apply during transfer</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
