// The shape of a failed form action on a page's re-render. The framework types
// actionData as unknown, and an ActionResult failure is what these pages bind.
export interface FormFailure {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export function formFailure(actionData: unknown): FormFailure {
  return typeof actionData === 'object' && actionData !== null ? (actionData as FormFailure) : {};
}
