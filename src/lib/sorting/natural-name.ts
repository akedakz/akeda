const cyrillicAlphabet = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
const latinAlphabet = "abcdefghijklmnopqrstuvwxyz";

type Chunk = { numeric: true; value: bigint; raw: string } | { numeric: false; value: string };

function normalize(value: string) { return value.trimStart().normalize("NFC").toLowerCase(); }

function leadingGroup(value: string) {
  const first = [...value][0] ?? "";
  if (isDigit(first)) return 0;
  if (cyrillicAlphabet.includes(first)) return 1;
  if (latinAlphabet.includes(first)) return 2;
  return 3;
}

function isDigit(value: string) { return value >= "0" && value <= "9"; }

function chunks(value: string): Chunk[] {
  const result: Chunk[] = [];
  for (const part of value.match(/\d+|\D+/gu) ?? []) {
    result.push(isDigit(part[0]) ? { numeric: true, value: BigInt(part), raw: part } : { numeric: false, value: part });
  }
  return result;
}

function characterRank(value: string) {
  const cyrillic = cyrillicAlphabet.indexOf(value);
  if (cyrillic >= 0) return [0, cyrillic] as const;
  const latin = latinAlphabet.indexOf(value);
  if (latin >= 0) return [1, latin] as const;
  return [2, value.codePointAt(0) ?? -1] as const;
}

function compareText(left: string, right: string) {
  const leftCharacters = [...left];
  const rightCharacters = [...right];
  for (let index = 0; index < Math.min(leftCharacters.length, rightCharacters.length); index += 1) {
    const leftRank = characterRank(leftCharacters[index]);
    const rightRank = characterRank(rightCharacters[index]);
    if (leftRank[0] !== rightRank[0]) return leftRank[0] - rightRank[0];
    if (leftRank[1] !== rightRank[1]) return leftRank[1] - rightRank[1];
  }
  return leftCharacters.length - rightCharacters.length;
}

function compareNames(left: string, right: string) {
  const groupDifference = leadingGroup(left) - leadingGroup(right);
  if (groupDifference) return groupDifference;
  const leftChunks = chunks(left);
  const rightChunks = chunks(right);
  for (let index = 0; index < Math.min(leftChunks.length, rightChunks.length); index += 1) {
    const leftChunk = leftChunks[index];
    const rightChunk = rightChunks[index];
    if (leftChunk.numeric && rightChunk.numeric) {
      if (leftChunk.value !== rightChunk.value) return leftChunk.value < rightChunk.value ? -1 : 1;
      if (leftChunk.raw.length !== rightChunk.raw.length) return leftChunk.raw.length - rightChunk.raw.length;
    } else if (!leftChunk.numeric && !rightChunk.numeric) {
      const difference = compareText(leftChunk.value, rightChunk.value);
      if (difference) return difference;
    } else {
      return leftChunk.numeric ? -1 : 1;
    }
  }
  return leftChunks.length - rightChunks.length;
}

export function compareNaturalNames(leftName: string, leftId: string, rightName: string, rightId: string) {
  const difference = compareNames(normalize(leftName), normalize(rightName));
  return difference || compareText(leftId, rightId);
}
