export interface ReportContext {
  region: "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";
  screenId: string | null;
  elementKey?: string;
}
export function report(error: unknown, context: ReportContext): void;
