import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { ConversionJob } from "../types";

const HISTORY_KEY = "conversion-history-v1";
const TRASH_KEY = "conversion-trash-v1";

export function useHistory() {
  const [history, setHistory] = useState<ConversionJob[]>([]);
  const [trash, setTrash] = useState<ConversionJob[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY).then((value) => {
      if (value) setHistory(JSON.parse(value));
    });
    AsyncStorage.getItem(TRASH_KEY).then((value) => {
      if (value) setTrash(JSON.parse(value));
    });
  }, []);

  const persistHistory = async (next: ConversionJob[]) => {
    setHistory(next);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  };

  const persistTrash = async (next: ConversionJob[]) => {
    setTrash(next);
    await AsyncStorage.setItem(TRASH_KEY, JSON.stringify(next));
  };

  const addHistory = async (job: ConversionJob) => {
    const next = [job, ...history].slice(0, 50);
    await persistHistory(next);
  };

  const clearHistory = async () => {
    const successfulJobs = history.filter((job) => job.status === "success");
    if (successfulJobs.length) {
      await persistTrash([...successfulJobs, ...trash].slice(0, 100));
    }
    await persistHistory([]);
  };

  const deleteHistoryJob = async (job: ConversionJob) => {
    await persistHistory(history.filter((item) => item.id !== job.id));
    if (job.status !== "success") return;
    await persistTrash([job, ...trash.filter((item) => item.id !== job.id)].slice(0, 100));
  };

  const restoreTrashJob = async (job: ConversionJob) => {
    await persistTrash(trash.filter((item) => item.id !== job.id));
    await persistHistory([job, ...history.filter((item) => item.id !== job.id)].slice(0, 50));
  };

  const deleteTrashJobForever = async (jobId: string) => {
    await persistTrash(trash.filter((item) => item.id !== jobId));
  };

  const emptyTrash = async () => {
    await persistTrash([]);
  };

  return {
    history,
    trash,
    addHistory,
    clearHistory,
    deleteHistoryJob,
    restoreTrashJob,
    deleteTrashJobForever,
    emptyTrash
  };
}
