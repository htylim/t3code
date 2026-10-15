type ThreadTagPickerListener = () => void;

const listeners = new Set<ThreadTagPickerListener>();

/** Open the active chat's picker from shortcuts or the command palette. */
export function requestThreadTagPicker(): void {
  for (const listener of listeners) listener();
}

/** Let the active chat reveal its composer controls before opening the picker. */
export function subscribeThreadTagPicker(listener: ThreadTagPickerListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
