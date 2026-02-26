import { GoogleGenerativeAI } from "@google/generative-ai";
import { resolveVariable, type ExecutionContext } from "../variableResolver.js";

type ActionInput = Record<string, any>;

export const aiDecision = async (inputs: ActionInput, context: ExecutionContext) => {
    
    const promptContext = resolveVariable(inputs.context, context);
    const rawOptions = resolveVariable(inputs.options, context);
    
    const validOptions = rawOptions.split(',').map((opt: string) => opt.trim()).filter((o: string) => o.length > 0);

    console.log(`   🧠 AI Decision: Choosing between [${validOptions.join(', ')}]...`);

    const apiKey = inputs.apiKey ? resolveVariable(inputs.apiKey, context) : process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API Key is missing.");

    const genAI = new GoogleGenerativeAI(apiKey);

    const systemPrompt = `
    You are an autonomous decision-making agent.
    
    CONTEXT:
    ${promptContext}

    TASK:
    Based strictly on the context above, select the single best action from the list below.
    
    VALID OPTIONS:
    ${JSON.stringify(validOptions)}
    
    CRITICAL RULES:
    1. You must respond with ONLY a valid JSON object.
    2. The "decision" field must be EXACTLY one of the valid options provided.
    3. Provide a brief "reason" for your choice.
    
    RESPONSE FORMAT:
    { "decision": "YOUR_SELECTION", "reason": "brief explanation" }
    `;

    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        const result = await model.generateContent(systemPrompt);
        const parsedResponse = JSON.parse(result.response.text());

        if (!validOptions.includes(parsedResponse.decision)) {
            console.warn(`      ⚠️ AI Hallucinated option "${parsedResponse.decision}". Defaulting to first option.`);
            parsedResponse.decision = validOptions[0];
        }

        console.log(`      -> Decision: ${parsedResponse.decision}`);

        return {
            "DECISION": parsedResponse.decision,
            "REASON": parsedResponse.reason,
            "STATUS": "Success"
        };
    } catch (error: any) {
        throw new Error(`AI Decision Failed: ${error.message}`);
    }
};