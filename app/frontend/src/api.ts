import type {
  BankSummaryModel,
  QuestionListResponseModel,
  QuestionModel,
} from "./types";

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: "Request failed." }));
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : JSON.stringify(payload.detail ?? "Request failed.");
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function openDemoBank(): Promise<BankSummaryModel> {
  return handleResponse(await fetch("/api/banks/open-demo", { method: "POST" }));
}

export async function openBank(path: string): Promise<BankSummaryModel> {
  return handleResponse(
    await fetch("/api/banks/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  );
}

export async function getCurrentBank(): Promise<BankSummaryModel> {
  return handleResponse(await fetch("/api/banks/current"));
}

export async function listQuestions(params: {
  search?: string;
  topic?: string;
  type?: string;
}): Promise<QuestionListResponseModel> {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  if (params.topic) searchParams.set("topic", params.topic);
  if (params.type) searchParams.set("type", params.type);
  return handleResponse(await fetch(`/api/questions?${searchParams.toString()}`));
}

export async function getQuestion(id: string): Promise<QuestionModel> {
  return handleResponse(await fetch(`/api/questions/${id}`));
}

export async function updateQuestion(id: string, question: QuestionModel): Promise<QuestionModel> {
  return handleResponse(
    await fetch(`/api/questions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(question),
    }),
  );
}

export async function saveBank(destinationPath?: string): Promise<{ saved_to: string }> {
  return handleResponse(
    await fetch("/api/banks/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination_path: destinationPath || null }),
    }),
  );
}
