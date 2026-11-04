import { DEAL_STAGES } from "@/lib/deals/constants";

export interface CustomStage {
  id: string;
  value: string;
  label: string;
  color: string;
  order: number;
  insertAfter?: string | null;
  archived?: boolean;
}

export interface PipelineStage {
  value: string;
  label: string;
  color: string;
  /** True for built-in (immutable) stages, false for custom rows. */
  builtin: boolean;
  /** Present on custom rows; undefined on built-ins. */
  customId?: string;
}

/**
 * Merge the static built-in pipeline with the account's custom
 * stages into a single ordered list. Each custom stage with an
 * `insertAfter` value slots in directly after that built-in.
 * Customs with insertAfter === null are appended at the end.
 * Customs sharing the same insertAfter slot are ordered by their
 * `order` field.
 *
 * Built-in stages whose value is in `archivedBuiltins` are dropped
 * from the visible pipeline but their customs are NOT orphaned —
 * customs that referenced an archived built-in still surface at
 * the position the built-in used to occupy. resolveStage continues
 * to render an archived built-in's label so existing deals on that
 * stage keep their pill.
 */
export function mergePipeline(custom: CustomStage[], archivedBuiltins: ReadonlyArray<string> = []): PipelineStage[] {
  const active = custom.filter((c) => !c.archived);
  const archivedSet = new Set(archivedBuiltins);
  const byInsertAfter = new Map<string | "__end__", CustomStage[]>();
  for (const c of active) {
    const key = c.insertAfter ?? "__end__";
    const bucket = byInsertAfter.get(key) ?? [];
    bucket.push(c);
    byInsertAfter.set(key, bucket);
  }
  for (const bucket of byInsertAfter.values()) {
    bucket.sort((a, b) => a.order - b.order);
  }

  const pipeline: PipelineStage[] = [];
  for (const b of DEAL_STAGES) {
    if (!archivedSet.has(b.value)) {
      pipeline.push({ value: b.value, label: b.label, color: b.color, builtin: true });
    }
    // Custom stages inserted after an archived built-in still appear —
    // they slot in where the built-in used to be.
    const after = byInsertAfter.get(b.value);
    if (after) {
      for (const c of after) {
        pipeline.push({ value: c.value, label: c.label, color: c.color, builtin: false, customId: c.id });
      }
    }
  }
  const tail = byInsertAfter.get("__end__");
  if (tail) {
    for (const c of tail) {
      pipeline.push({ value: c.value, label: c.label, color: c.color, builtin: false, customId: c.id });
    }
  }
  return pipeline;
}

/** Resolve a stage value (built-in or custom) into its display info. */
export function resolveStage(value: string, custom: CustomStage[]): PipelineStage {
  const c = custom.find((s) => s.value === value);
  if (c) {
    return { value: c.value, label: c.label, color: c.color, builtin: false, customId: c.id };
  }
  const b = DEAL_STAGES.find((s) => s.value === value);
  if (b) return { value: b.value, label: b.label, color: b.color, builtin: true };
  return { value, label: value, color: "bg-gray-100 text-gray-700", builtin: false };
}
