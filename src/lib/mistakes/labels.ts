export function taskCountLabel(count: number, adjective = false) {
  const mod100 = count % 100, mod10 = count % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? "задач" : mod10 === 1 ? "задача" : mod10 >= 2 && mod10 <= 4 ? "задачи" : "задач";
  return `${count} ${adjective && word === "задача" ? "активная задача" : adjective && word === "задачи" ? "активные задачи" : adjective ? "активных задач" : word}`;
}
