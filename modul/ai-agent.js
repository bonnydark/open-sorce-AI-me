/** Browser adapter for the bounded, read-only agentic workflow. */
export const id="ai-agent";
export const name="GortGPT Agent · Plan & Act";
export const version="1.0.0";
export const mode="api";
export const capabilities=["multi-step-planning","bounded-tool-use","read-only-web-search","public-page-retrieval","conversation-continuity"];
export let currentConversationId=null;
export function setConversation(id){currentConversationId=id||null}
export function clearMemory(){currentConversationId=null}
export function getMemorySize(){return currentConversationId?1:0}
export async function respond(prompt,conversationId=currentConversationId,images=[]){
 const message=String(prompt??"").trim();
 if(!message)throw new Error("Enter a task for the agent.");
 if(message.length>20000)throw new Error("Message is too long (20,000 characters max).");
 const response=await fetch(new URL("/api/chat",globalThis.location.origin),{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},credentials:"same-origin",body:JSON.stringify({message,conversationId:conversationId||undefined,images:Array.isArray(images)?images.slice(0,3):[],moduleId:id})});
 let data;try{data=await response.json()}catch{throw new Error("The agent backend returned invalid JSON.")}
 if(data.conversationId)currentConversationId=data.conversationId;
 if(!response.ok)throw new Error(data?.error||("Agent backend HTTP "+response.status));
 const answer=data?.reply??data?.response??data?.answer;
 if(typeof answer!=="string"||!answer.trim())throw new Error("Agent backend returned an empty response.");
 return answer;
}
