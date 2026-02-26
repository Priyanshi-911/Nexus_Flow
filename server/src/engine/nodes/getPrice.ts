import { resolveVariable, type ExecutionContext } from "../variableResolver.js";

type ActionInput = Record<string, any>;

export const getPriceCoinGecko = async (inputs: ActionInput, context: ExecutionContext) => {
    const rawTokenId = resolveVariable(inputs.tokenId, context); 
    
    // Normalize input to lower case and trim whitespace for robust matching
    const tokenId = rawTokenId?.toString().toLowerCase().trim();

    console.log(`   💰 Executing Price Node: Fetching price for "${tokenId}"...`);

    if (!tokenId) {
        throw new Error("Invalid Input: Token name/ID cannot be empty.");
    }

    try {
        const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(tokenId)}&vs_currencies=usd`
        );

        if (!response.ok) {
            throw new Error(`CoinGecko API error: ${response.statusText}`);
        }

        const data = await response.json();
            
        // Check if the token exists in the response
        if (!data[tokenId] || data[tokenId].usd === undefined) {
            throw new Error(`Token "${tokenId}" not found on CoinGecko. Please ensure you are using the correct API ID (e.g., 'ethereum' instead of 'ETH').`);
        }

        const price = data[tokenId].usd;
        console.log(`      -> Price is $${price}`);

        return { [`PRICE`]: price };
    } catch (error: any) {
        console.error(`   ❌ Price Node Error: ${error.message}`);
        throw error; // Re-throw to be caught by the engine's node_failed listener
    }
};