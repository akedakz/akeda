import { uploadTestImportImageRequest } from "@/lib/tests/test-import-session";

const MAX_IMPORT_IMAGE_REQUEST_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_IMAGE_REQUEST_BYTES) {
      return Response.json({ ok: false, message: "Изображение слишком большое." }, { status: 413 });
    }
    const formData = await request.formData();
    const testId = formData.get("testId");
    const importToken = formData.get("importToken");
    const questionKey = formData.get("questionKey");
    if (typeof testId !== "string" || typeof importToken !== "string" || typeof questionKey !== "string") {
      return Response.json({ ok: false, message: "Некорректные данные загрузки изображения." }, { status: 400 });
    }
    const result = await uploadTestImportImageRequest(testId, importToken, questionKey, formData.get("file"));
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch {
    return Response.json({ ok: false, message: "Не удалось прочитать изображение импорта." }, { status: 400 });
  }
}
