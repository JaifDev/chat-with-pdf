import { db } from "@/db";
import { pinecone } from "@/lib/pinecone";
import { SendMessageValidator } from "@/lib/validators/sendMessageValidator";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { PineconeStore } from "@langchain/pinecone";
import { NextRequest } from "next/server";
import { MistralAIEmbeddings } from "@langchain/mistralai";
import { MistralStream, StreamingTextResponse } from "ai";
import MistralClient, {
  ChatCompletionResponseChunk,
} from "@mistralai/mistralai";

const mistral = new MistralClient(process.env.MISTRAL_API_KEY || "");

export const POST = async (req: NextRequest) => {
  // Endpoint for asking a question to a PDF file

  const body = await req.json();

  const { getUser } = getKindeServerSession();
  const user = await getUser();

  const userId = user?.id;

  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { fileId, message } = SendMessageValidator.parse(body);

  const file = await db.file.findFirst({
    where: {
      id: fileId,
      userId,
    },
  });

  if (!file) return new Response("Not Found", { status: 404 });

  await db.message.create({
    data: {
      text: message,
      isUserMessage: true,
      userId,
      fileId,
    },
  });

  // Vectorize the message
  const pineconeIndex = pinecone.Index("docket");
  const embeddings = new MistralAIEmbeddings({
    apiKey: process.env.MISTRAL_API_KEY,
  });

  const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
    namespace: file.id,
  });

  const results = await vectorStore.similaritySearch(message, 4);

  const previousMessages = await db.message.findMany({
    where: {
      fileId,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 6,
  });

  const formattedPrevMessages = previousMessages.map((msg) => ({
    role: msg.isUserMessage ? "user" : "assistant",
    content: msg.text,
  }));

  const response: any = mistral.chatStream({
    model: "mistral-small-latest",
    maxTokens: 1000,
    messages: [
      {
        role: "system",
        content:
          "Use the following pieces of context (or previous conversation if needed) to answer the user's question in markdown format.",
      },
      {
        role: "user",
        content: `Use the following pieces of context (or previous conversation if needed) to answer the user's question in markdown format. 
        If you don't know the answer, just say that you don't know, don't try to make up an answer.
        
        \n----------------\n
        
        PREVIOUS CONVERSATION:
        ${formattedPrevMessages
          .map((message) => {
            if (message.role === "user") return `User: ${message.content}\n`;
            return `Assistant: ${message.content}\n`;
          })
          .join("")}
        
        \n----------------\n
        
        CONTEXT:
        ${results.map((r) => r.pageContent).join("\n\n")}
        
        USER INPUT: ${message}`,
      },
    ],
  });

  const stream = MistralStream(response, {
    async onCompletion(completion) {
      await db.message.create({
        data: {
          text: completion,
          isUserMessage: false,
          fileId,
          userId,
        },
      });
    },
  });

  return new StreamingTextResponse(stream);
};
