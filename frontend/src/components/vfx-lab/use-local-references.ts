"use client";
import { useEffect, useRef, useState } from "react";
import type { Reference } from "@/lib/project-types";
import type { ReferenceState } from "../studio/use-references";
import { referenceName } from "../studio/board/board-store";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("autov-local-board", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("references", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Local image storage unavailable."));
  });
}
async function stored(
  action: "read" | "put" | "delete",
  value?: Reference | string,
): Promise<Reference[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "references",
        action === "read" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("references");
      const request =
        action === "read"
          ? store.getAll()
          : action === "put"
            ? store.put(value)
            : store.delete(value as string);
      tx.oncomplete = () =>
        resolve(action === "read" ? (request.result as Reference[]) : []);
      tx.onerror = tx.onabort = () =>
        reject(
          new Error("Could not save board images. Check browser storage."),
        );
    });
  } finally {
    db.close();
  }
}
export async function prepareReference(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Reference image is unavailable.");
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation failed.");
    context.fillStyle = "#101112";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.87);
  } finally {
    bitmap.close();
  }
}
export function useLocalReferences(): ReferenceState {
  const [references, setReferences] = useState<Reference[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const lock = useRef(true);
  const latest = useRef<Reference[]>([]);
  useEffect(() => {
    let active = true;
    stored("read")
      .then((items) => {
        if (active) {
          latest.current = items;
          setReferences(items);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) {
          lock.current = false;
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function uploadFile(file: File): Promise<Reference> {
    if (lock.current) throw new Error("Wait for the current upload to finish.");
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      ) ||
      !file.size ||
      file.size > 20 * 1024 * 1024
    )
      throw new Error("Use PNG, JPEG, WebP or GIF images up to 20 MB.");
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read image."));
        reader.readAsDataURL(file);
      });
      await prepareReference(url); // Reject undecodable images before adding a ready reference.
      const base = referenceName(file.name);
      let name = base;
      let suffix = 2;
      while (
        latest.current.some((r) => r.name.toLowerCase() === name.toLowerCase())
      )
        name = `${base} ${suffix++}`;
      const reference = { id: crypto.randomUUID(), name, url, type: file.type };
      await stored("put", reference);
      latest.current = [...latest.current, reference];
      setReferences(latest.current);
      return reference;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function addFiles(files: FileList | File[] | null) {
    for (const file of Array.from(files || []))
      try {
        await uploadFile(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
  }
  async function removeReference(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await stored("delete", id);
      latest.current = latest.current.filter((r) => r.id !== id);
      setReferences(latest.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove reference.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    references,
    busy,
    error,
    setError,
    uploadFile,
    addFiles,
    removeReference,
    refresh: () => {},
  };
}
