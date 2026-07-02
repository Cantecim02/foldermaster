import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConvertedFile } from "../types";

export type ZippedOutput = ConvertedFile & {
  createdAt: string;
};

const storageKey = "multi_file_converter:zipped_outputs";
const maxItems = 20;

export async function addZippedOutput(file: ConvertedFile) {
  const current = await listZippedOutputs();
  const next: ZippedOutput[] = [
    { ...file, createdAt: new Date().toISOString() },
    ...current.filter((item) => item.uri !== file.uri)
  ].slice(0, maxItems);
  await AsyncStorage.setItem(storageKey, JSON.stringify(next));
}

export async function listZippedOutputs(): Promise<ZippedOutput[]> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as ZippedOutput[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function removeZippedOutput(uri: string) {
  const current = await listZippedOutputs();
  await AsyncStorage.setItem(storageKey, JSON.stringify(current.filter((item) => item.uri !== uri)));
}
