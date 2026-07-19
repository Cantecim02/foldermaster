import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { ConversionJob } from "../types";

const HISTORY_KEY = "conversion-history-v1";
const TRASH_KEY = "conversion-trash-v1";

export function useHistory(accountId: string | null = null) {
  const [history, setHistory] = useState<ConversionJob[]>([]);
  const [trash, setTrash] = useState<ConversionJob[]>([]);

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      const [deviceHistory, deviceTrash] = await Promise.all([
        AsyncStorage.getItem(HISTORY_KEY),
        AsyncStorage.getItem(TRASH_KEY)
      ]);

      if (!accountId) {
        if (active) {
          setHistory(parseJobs(deviceHistory));
          setTrash(parseJobs(deviceTrash));
        }
        return;
      }

      const [storedHistory, storedTrash] = await Promise.all([
        AsyncStorage.getItem(accountHistoryKey(accountId)),
        AsyncStorage.getItem(accountTrashKey(accountId))
      ]);
      const isFirstAccountLoad = storedHistory === null && storedTrash === null;
      const nextHistory = parseJobs(isFirstAccountLoad ? deviceHistory : storedHistory);
      const nextTrash = parseJobs(isFirstAccountLoad ? deviceTrash : storedTrash);

      if (isFirstAccountLoad) {
        await Promise.all([
          AsyncStorage.setItem(accountHistoryKey(accountId), JSON.stringify(nextHistory)),
          AsyncStorage.setItem(accountTrashKey(accountId), JSON.stringify(nextTrash))
        ]);
      }

      if (!active) return;
      setHistory(nextHistory);
      setTrash(nextTrash);
      await Promise.all([
        AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory)),
        AsyncStorage.setItem(TRASH_KEY, JSON.stringify(nextTrash))
      ]);
    };

    void hydrate().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [accountId]);

  const persistHistory = async (next: ConversionJob[]) => {
    setHistory(next);
    const value = JSON.stringify(next);
    await Promise.all([
      AsyncStorage.setItem(HISTORY_KEY, value),
      ...(accountId ? [AsyncStorage.setItem(accountHistoryKey(accountId), value)] : [])
    ]);
  };

  const persistTrash = async (next: ConversionJob[]) => {
    setTrash(next);
    const value = JSON.stringify(next);
    await Promise.all([
      AsyncStorage.setItem(TRASH_KEY, value),
      ...(accountId ? [AsyncStorage.setItem(accountTrashKey(accountId), value)] : [])
    ]);
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

  const endAccountHistorySession = async (currentAccountId: string, deletePermanently: boolean) => {
    setHistory([]);
    setTrash([]);
    await Promise.all([
      AsyncStorage.removeItem(HISTORY_KEY),
      AsyncStorage.removeItem(TRASH_KEY),
      ...(deletePermanently
        ? [
            AsyncStorage.removeItem(accountHistoryKey(currentAccountId)),
            AsyncStorage.removeItem(accountTrashKey(currentAccountId))
          ]
        : [])
    ]);
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
    endAccountHistorySession,
    deleteHistoryJob,
    restoreTrashJob,
    deleteTrashJobForever,
    emptyTrash
  };
}

function accountHistoryKey(accountId: string) {
  return `${HISTORY_KEY}:account:${accountId}`;
}

function accountTrashKey(accountId: string) {
  return `${TRASH_KEY}:account:${accountId}`;
}

function parseJobs(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as ConversionJob[] : [];
  } catch {
    return [];
  }
}
