export const librarySortValues = ["created_desc", "created_asc", "name_asc", "name_desc"] as const;
export type LibrarySort = (typeof librarySortValues)[number];
export const defaultLibrarySort: LibrarySort = "name_asc";

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

export function parseLibrarySort(value: string | string[] | undefined): LibrarySort {
  const candidate = Array.isArray(value) ? value[0] : value;
  return librarySortValues.includes(candidate as LibrarySort) ? candidate as LibrarySort : defaultLibrarySort;
}

export function sortLibraryItems<T>(items: T[], sort: LibrarySort, getName: (item: T) => string, getCreatedAt: (item: T) => string) {
  return [...items].sort((first, second) => {
    if (sort === "name_asc" || sort === "name_desc") {
      const result = collator.compare(getName(first), getName(second));
      return sort === "name_asc" ? result : -result;
    }
    const result = new Date(getCreatedAt(first)).getTime() - new Date(getCreatedAt(second)).getTime();
    return sort === "created_asc" ? result : -result;
  });
}

export function withSort(path: string, sort: LibrarySort) {
  return `${path}?sort=${sort}`;
}
