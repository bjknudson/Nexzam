export type QuestionType =
  | "multiple_choice"
  | "numeric_response"
  | "short_answer"
  | "free_response";

export interface AssetModel {
  path: string;
  kind: string;
  svg_variables: Record<string, string>;
}

export interface AssetUploadResponseModel {
  path: string;
  kind: string;
}

export interface AssetInspectionResponseModel {
  path: string;
  kind: string;
  svg_placeholders: string[];
  rendered_svg?: string | null;
}

export interface AssetListItemModel {
  path: string;
  kind: string;
  referenced_by: string[];
  svg_placeholders: string[];
}

export interface AssetListResponseModel {
  items: AssetListItemModel[];
}

export interface RubricRowModel {
  criterion: string;
  points: number;
}

export interface ManifestModel {
  schema_version: string;
  bank_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  difficulty_labels: Record<string, string>;
}

export interface BankIndexModel {
  question_ids: string[];
  topics: string[];
  updated_at: string;
}

export interface BankSummaryModel {
  source_path: string;
  workspace_path: string;
  manifest: ManifestModel;
  bank: BankIndexModel;
}

export interface QuestionModel {
  id: string;
  type: QuestionType;
  topic: string;
  difficulty: number;
  prompt: string;
  subtopic?: string | null;
  tags: string[];
  standards: string[];
  estimated_time_sec?: number | null;
  points?: number | null;
  status: string;
  teacher_notes?: string | null;
  answer?: Record<string, unknown> | null;
  explanation?: string | null;
  rubric: RubricRowModel[];
  sample_solution?: string | null;
  exemplar_answer?: string | null;
  assets: AssetModel[];
}

export interface QuestionListItemModel {
  id: string;
  topic: string;
  type: QuestionType;
  difficulty: number;
  status: string;
  prompt: string;
}

export interface QuestionListResponseModel {
  items: QuestionListItemModel[];
  available_topics: string[];
  available_types: string[];
}

export interface DesktopContext {
  isDesktop: boolean;
  backendBaseUrl: string | null;
  backendReady: boolean;
  backendError: string | null;
  archiveDirty: boolean;
}
