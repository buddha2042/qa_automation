export interface UploadedFileLike {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export function isUploadedFile(value: FormDataEntryValue | null): value is UploadedFileLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function'
  );
}
