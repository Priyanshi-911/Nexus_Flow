import { resolveVariable, type ExecutionContext } from "../variableResolver.js";
import { createNexusAccount } from "../smartAccount.js";
import { Sanitize } from "../utils/inputSanitizer.js";
import { KNOWN_TOKENS } from "../utils/tokenRegistry.js";
import { createPublicClient, http, parseAbi, encodeFunctionData, parseUnits, formatUnits } from "viem";
import { sepolia } from "viem/chains";

type ActionInput = Record<string, any>;

export const transfer = async (inputs: ActionInput, context: ExecutionContext) => {
    // 1. Resolve Frontend Selections
    const toRaw = resolveVariable(inputs.toAddress, context);
    const toAddress = Sanitize.address(toRaw);
    const rawAmt = resolveVariable(inputs.amount, context);
    const amount = Sanitize.number(rawAmt);
    const selectedToken = resolveVariable(inputs.currency, context);

    if (!toAddress || !toAddress.startsWith("0x")) {
        throw new Error(`Invalid Destination Address: ${toRaw}`);
    }

    // 2. Map to Registry or Fallback to Custom
    const tokenConfig = KNOWN_TOKENS[selectedToken] || {
        address: resolveVariable(inputs.customToken, context),
        decimals: 18, // Defaulting custom tokens to 18 decimals
        isNative: false
    };

    const tokenAddress = Sanitize.address(tokenConfig.address);
    const amountBigInt = parseUnits(amount.toString(), tokenConfig.decimals);

    console.log(`   ➡️ Executing Transfer Node: Sending ${amount} ${selectedToken} to ${toAddress}...`);

    // 3. Initialize the Smart Account
    const nexusClient = await createNexusAccount(0);
    const accountAddress = nexusClient.account.address;

    // --- 🟢 PRE-FLIGHT BALANCE GUARDRAIL (WITH ACTIONABLE ERROR) ---
    console.log(`      -> Verifying ${selectedToken} balance for ${accountAddress}...`);
    
    const publicClient = createPublicClient({ chain: sepolia, transport: http() });

    let balance: bigint;
    if (tokenConfig.isNative) {
        balance = await publicClient.getBalance({ address: accountAddress as `0x${string}` });
    } else {
        const erc20Abi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
        balance = await publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [accountAddress as `0x${string}`]
        }) as bigint;
    }

    if (balance < amountBigInt) {
        const missingAmountBigInt = amountBigInt - balance;
        
        // Construct an Actionable Payload for the Frontend Deposit Modal
        const errorPayload = {
            code: "DEPOSIT_REQUIRED",
            tokenSymbol: selectedToken,
            tokenAddress: tokenAddress,
            isNative: tokenConfig.isNative,
            missingAmountRaw: missingAmountBigInt.toString(), 
            missingAmountFormatted: formatUnits(missingAmountBigInt, tokenConfig.decimals),
            decimals: tokenConfig.decimals,
            accountAddress: accountAddress,
            workflowId: (context as any).SYSTEM_WORKFLOW_ID || null,
        };

        // Throwing this prefix triggers the UI to intercept it instead of just showing a generic error
        throw new Error(`[ACTION_REQUIRED] ${JSON.stringify(errorPayload)}`);
    }
    console.log(`      -> Balance verified! Building transaction...`);
    // --- END GUARDRAIL ---

    // 4. Construct the Transaction
    const calls: any[] = [];

    if (tokenConfig.isNative) {
        // Native ETH Transfer
        calls.push({
            to: toAddress as `0x${string}`,
            value: amountBigInt,
            data: "0x"
        });
    } else {
        // ERC-20 Transfer
        const erc20Abi = parseAbi(["function transfer(address to, uint256 amount)"]);
        const transferData = encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [toAddress as `0x${string}`, amountBigInt]
        });

        calls.push({
            to: tokenAddress as `0x${string}`,
            value: 0n,
            data: transferData
        });
    }

    // 5. Execute via UserOperation
    console.log(`      -> Sending UserOperation...`);
    const userOpHash = await nexusClient.sendUserOperation({ calls });
    
    console.log(`      -> UserOp Sent (Hash: ${userOpHash}). Waiting for bundler...`);

    const receipt = await nexusClient.waitForUserOperationReceipt({ hash: userOpHash });
    const txHash = receipt.receipt.transactionHash;

    const explorerLink = `https://sepolia.etherscan.io/tx/${txHash}`;
    console.log(`      ✅ Transfer Complete! Hash: ${txHash}`);
    console.log(`      🔗 View on Etherscan: ${explorerLink}`);

    return { 
        "TX_HASH": txHash,
        "EXPLORER_LINK": explorerLink,
        "STATUS": "Success"
    };
};