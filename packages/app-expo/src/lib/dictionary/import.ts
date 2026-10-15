/**
 * Import whatever dictionary was picked, recognising the format from what is
 * inside rather than from the file name — a StarDict set renamed .zip, or a
 * Yomitan pack saved without its extension, still imports.
 */
import { type PickedFile, readPickedFiles } from "./archive";
import { importStarDictFiles, isStarDict } from "./stardict-import";
import { type DictionaryInfo, importYomitanFiles, isYomitan } from "./yomitan-import";

export async function importDictionaries(
  picked: PickedFile[],
  onProgress?: (done: number, total: number, title: string) => void,
): Promise<DictionaryInfo[]> {
  const files = await readPickedFiles(picked);

  if (isYomitan(files)) return [await importYomitanFiles(files, onProgress)];
  if (isStarDict(files)) return importStarDictFiles(files, onProgress);

  throw new Error(
    "Not a dictionary this app can read. Supported: Yomitan (.zip) and StarDict (.ifo with its .idx and .dict, loose or in a .zip / .tar.gz).",
  );
}
