# Màn Tạo ảnh — kế hoạch triển khai

> **Cho người thực thi:** dùng skill `superpowers:executing-plans` để chạy kế hoạch này từng việc một.

**Mục tiêu:** Thay luồng tạo ảnh dạng bong bóng chat bằng màn "Tạo ảnh" riêng theo Figma (form → đang tạo → kết quả → xem lớn → lỗi), có phong cách, tỷ lệ, tiêu đề ngắn do AI đặt, và lưu ảnh vào thư viện Ảnh.

**Kiến trúc:** Backend nhận thêm `image_style` + `aspect_ratio`, lưu vào `metadata` của tin trả lời, dịch sang tham số của nhà cung cấp; tiêu đề ngắn chạy song song với việc tạo ảnh. App có `ImageGenScreen` (một màn, 4 trạng thái suy ra từ tin cuối của phiên) và `ImageViewerScreen`, dùng lại tầng API sẵn có (tạo phiên, gửi, SSE, `/stop`, `/retry`).

**Công nghệ:** NestJS + Prisma + vitest (Mindo-API) · React Native 0.73 + react-query + jest (Mindo-App) · `@react-native-camera-roll/camera-roll` (mới).

**Thiết kế:** [image-generation-screen-design.md](image-generation-screen-design.md)

---

## Quy ước chung

- Commit message **tiếng Anh**, KHÔNG thêm dòng ghi công Claude Code.
- Chú thích trong code **tiếng Việt**, giải thích *vì sao*.
- TDD: mỗi việc viết test đỏ trước, chạy thấy đỏ, rồi mới viết code.
- **Kiểm nhánh trước mỗi commit** (`git branch --show-current`) — phiên khác từng chuyển repo về `main` giữa chừng.
- Lệnh test:
  - API: `cd /Users/Work_home/Project_Hungs/Mindo/Mindo-API && npx vitest run <file>`
  - App: `cd /Users/Work_home/Project_Hungs/Mindo/Mindo-App && npx jest <file>`

## Số đo Figma (khung 393×852)

| Phần | Số đo |
|---|---|
| Lề ngang | 24, nội dung rộng 345 |
| Header → hero | đường kẻ y=109, hero y=140 → cách 31 |
| Hero | bold 25, hai dòng cách 34 |
| Nhãn trường | medium 13, lh 20, cách trường bên dưới 8 |
| Ô mô tả | cao 141, bo 16, nền `#F5F7FA`, viền `#E6EBF2`, đệm 16, chữ regular 14 |
| Trường → nhãn kế | 37 |
| Chip phong cách | cao 43, 2 cột cách 16, 2 hàng cách 9, bo 14 · chọn: nền `#021C41` chữ trắng · chưa chọn: nền trắng viền `#D8E0EA` |
| Chip tỷ lệ | cao 43, 3 cột cách 11 · chọn: nền `#F1F6DA` viền `#B9D900` |
| Nút chính | cao 52, bo 16, bold 15, đáy cách mép màn 56 (34 safe-area + 22) |
| Khung ảnh | rộng 345, bo 20, nền `#EFF5DC`, 2 vòng trang trí `#E3EDBF` / `#E8F0D2` |
| Đang tạo | thẻ mô tả cách đường kẻ 27; khung cách thẻ 29; vòng trắng 56 + sparkle; tiêu đề bold 15; phụ đề regular 12 `#617084` |
| Kết quả | tiêu đề bold 20 cách đường kẻ 22; khung cách tiêu đề 11; hàng nút cao 44 cách khung 21; "Mô tả đã dùng" cách hàng nút 31; thẻ mô tả chữ regular 13 `#617084` |
| Xem lớn | nền `#07172D`; nút 36 nền `#21334B` icon trắng; ảnh rộng hết màn; tiêu đề bold 17 trắng; bộ đếm regular 12 `#8B9DB3` |
| Lỗi | vòng 76 nền `#FFF2F0` icon `#C9362A`; tiêu đề bold 21; mô tả regular 13 `#617084` lh 23 |

---

# PHẦN A — Nhánh

### Việc A1: Cất phần việc đang dở lên nhánh riêng

Cả hai repo đang ở `main` với thay đổi chưa commit từ các việc trước. Phải cất trước, kẻo lẫn vào tính năng mới.

**Mindo-API** (2 file Pollinations):

```bash
cd /Users/Work_home/Project_Hungs/Mindo/Mindo-API
git branch --show-current            # phải là main
git status --short                   # phải thấy đúng 2 file ai-provider + docs chưa track
git checkout -b feat/image-generation
git add api/src/phase2/ai-provider.service.ts api/src/phase2/ai-provider.service.spec.ts
git commit -m "feat(ai): pick the image vendor with IMAGE_VENDOR, add a keyless Pollinations driver"
git add docs/image-generation-screen-design.md docs/image-generation-screen-implementation-plan.md
git commit -m "docs(ai): design and plan for the dedicated image generation screen"
```

KHÔNG `git add` file `docs/call-log-bubble-and-flow-test-plan.md` — việc khác.

**Mindo-App** (7 file Dừng/Thử lại):

```bash
cd /Users/Work_home/Project_Hungs/Mindo/Mindo-App
git branch --show-current            # phải là main
git checkout -b feat/ai-chat-stop-retry
git add src/i18n/BaseLanguage.ts src/i18n/en.ts src/i18n/vi.ts \
  src/screens/AiChatScreen/AiChatScreen.tsx \
  src/screens/AiChatScreen/components/AssistantMessage.tsx \
  src/services/__tests__/aiChatApi.test.ts src/services/aiChatApi.ts
git commit -m "feat(ai-chat): really stop a reply, retry failed ones, show cancelled as stopped"
git checkout -b feat/image-gen-screen
```

`feat/image-gen-screen` xếp chồng lên `feat/ai-chat-stop-retry` vì dùng `stopMessage` / `retryMessage`.

---

# PHẦN B — Backend (Mindo-API)

### Việc B1: Hàm thuần cho tuỳ chọn ảnh

**Tạo:** `api/src/phase2/ai-image.options.ts`, `api/src/phase2/ai-image.options.test.ts`

**Bước 1 — test đỏ:**

```ts
// api/src/phase2/ai-image.options.test.ts
import { describe, expect, it } from 'vitest';
import {
  aspectRatioOf, imageDimensions, imageStyleOf, sanitizeTitle, styledPrompt,
} from './ai-image.options';

describe('tuỳ chọn tạo ảnh', () => {
  it('mỗi tỷ lệ ra đúng khung, cạnh là bội số của 64', () => {
    expect(imageDimensions('1:1')).toEqual({ width: 1024, height: 1024 });
    expect(imageDimensions('4:3')).toEqual({ width: 1024, height: 768 });
    expect(imageDimensions('9:16')).toEqual({ width: 768, height: 1344 });
  });

  it('giá trị lạ hoặc thiếu lùi về mặc định, không ném', () => {
    /* metadata của phiên ảnh cũ không có hai trường này */
    expect(imageStyleOf(undefined)).toBe('AUTO');
    expect(imageStyleOf('VAN_GOGH')).toBe('AUTO');
    expect(aspectRatioOf(undefined)).toBe('1:1');
    expect(aspectRatioOf('21:9')).toBe('1:1');
    expect(imageStyleOf('THREE_D')).toBe('THREE_D');
    expect(aspectRatioOf('9:16')).toBe('9:16');
  });

  it('AUTO giữ nguyên mô tả; phong cách khác nối thêm chỉ dẫn', () => {
    expect(styledPrompt('  mèo đen  ', 'AUTO')).toBe('mèo đen');
    const styled = styledPrompt('mèo đen', 'THREE_D');
    expect(styled.startsWith('mèo đen')).toBe(true);
    expect(styled).toContain('3D render');
  });

  it('tiêu đề: bỏ ngoặc, dấu chấm, chỉ lấy dòng đầu', () => {
    expect(sanitizeTitle('"Robot Mindo 3D".')).toBe('Robot Mindo 3D');
    expect(sanitizeTitle('“Mèo cao bồi”')).toBe('Mèo cao bồi');
    expect(sanitizeTitle('\n  Quán cà phê Hà Nội\nGiải thích: ...')).toBe('Quán cà phê Hà Nội');
  });

  it('tiêu đề rỗng hoặc dài quá thì trả null để lùi về mô tả cắt ngắn', () => {
    expect(sanitizeTitle('')).toBeNull();
    expect(sanitizeTitle(null)).toBeNull();
    expect(sanitizeTitle('"".')).toBeNull();
    expect(sanitizeTitle('a'.repeat(61))).toBeNull();
  });
});
```

**Bước 2:** `npx vitest run api/src/phase2/ai-image.options.test.ts` → ĐỎ (không tìm thấy module).

**Bước 3 — code:**

```ts
// api/src/phase2/ai-image.options.ts
/**
 * Tuỳ chọn tạo ảnh: phong cách, tỷ lệ, tiêu đề ngắn.
 *
 * Để thành hàm thuần vì ba nơi cùng dùng: DTO kiểm giá trị, `AiService` lưu
 * vào metadata, `AiProviderService` dịch sang tham số của từng nhà cung cấp.
 * Ba nơi mà mỗi nơi tự khai danh sách thì sớm muộn sẽ lệch nhau.
 */
export const AI_IMAGE_STYLES = ['AUTO', 'NATURAL', 'THREE_D', 'ILLUSTRATION'] as const;
export type AiImageStyle = (typeof AI_IMAGE_STYLES)[number];

export const AI_ASPECT_RATIOS = ['1:1', '4:3', '9:16'] as const;
export type AiAspectRatio = (typeof AI_ASPECT_RATIOS)[number];

export const DEFAULT_IMAGE_STYLE: AiImageStyle = 'AUTO';
export const DEFAULT_ASPECT_RATIO: AiAspectRatio = '1:1';

/* Bội số của 64: cỡ mà các model khuếch tán nhận mà không tự cắt xén */
const DIMENSIONS: Record<AiAspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '9:16': { width: 768, height: 1344 },
};

/*
  Chỉ dẫn bằng tiếng Anh dù mô tả là tiếng Việt: model ảnh làm theo chỉ dẫn
  phong cách tiếng Anh ổn định hơn hẳn. Nằm ở server để đổi câu chữ mà không
  phải phát hành lại app.
*/
const STYLE_HINTS: Record<AiImageStyle, string | null> = {
  AUTO: null,
  NATURAL: 'Style: natural photograph, realistic lighting and textures.',
  THREE_D: 'Style: 3D render, soft studio lighting, smooth materials, high detail.',
  ILLUSTRATION: 'Style: flat digital illustration, clean lines, simple shapes.',
};

const TITLE_MAX = 60;

export const isImageStyle = (value: unknown): value is AiImageStyle =>
  typeof value === 'string' && (AI_IMAGE_STYLES as readonly string[]).includes(value);

export const isAspectRatio = (value: unknown): value is AiAspectRatio =>
  typeof value === 'string' && (AI_ASPECT_RATIOS as readonly string[]).includes(value);

/** Phiên ảnh cũ không có metadata này — lùi về mặc định chứ không ném */
export const imageStyleOf = (value: unknown): AiImageStyle => (isImageStyle(value) ? value : DEFAULT_IMAGE_STYLE);

export const aspectRatioOf = (value: unknown): AiAspectRatio => (isAspectRatio(value) ? value : DEFAULT_ASPECT_RATIO);

export const imageDimensions = (ratio: AiAspectRatio) => DIMENSIONS[ratio];

export function styledPrompt(prompt: string, style: AiImageStyle): string {
  const hint = STYLE_HINTS[style];
  return hint ? `${prompt.trim()}\n\n${hint}` : prompt.trim();
}

/**
 * Dọn câu trả lời của model thành một tiêu đề.
 *
 * Model hay "trang trí": bọc ngoặc kép, thêm dấu chấm, hoặc giải thích thêm
 * một dòng. Dài quá thì trả `null` chứ không cắt ngang — cắt giữa chữ trông
 * còn tệ hơn mô tả cắt ngắn mà hệ thống đang có sẵn.
 */
export function sanitizeTitle(raw: string | null | undefined): string | null {
  const firstLine = (raw ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const clean = firstLine
    .replace(/^["'“”«»*#\-\s]+/, '')
    .replace(/["'“”«»*.\s]+$/, '')
    .trim();
  if (!clean || clean.length > TITLE_MAX) return null;
  return clean;
}
```

**Bước 4:** chạy lại → XANH (5 test).

**Bước 5:**
```bash
git add api/src/phase2/ai-image.options.ts api/src/phase2/ai-image.options.test.ts
git commit -m "feat(ai): image style, aspect ratio and title helpers"
```

---

### Việc B2: DTO nhận `image_style` và `aspect_ratio`

**Sửa:** `api/src/phase2/phase2.dto.ts` · **Tạo:** `api/src/phase2/ai-message.dto.test.ts`

**Bước 1 — test đỏ:**

```ts
// api/src/phase2/ai-message.dto.test.ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAiMessageDto } from './phase2.dto';

const errorsOf = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateAiMessageDto, body))).map((error) => error.property);

describe('CreateAiMessageDto — tuỳ chọn ảnh', () => {
  it('nhận đủ phong cách và tỷ lệ hợp lệ', async () => {
    expect(await errorsOf({ content: 'mèo', kind: 'IMAGE', image_style: 'THREE_D', aspect_ratio: '9:16' })).toEqual([]);
  });

  it('hai trường là tuỳ chọn — client cũ không gửi vẫn qua', async () => {
    expect(await errorsOf({ content: 'mèo', kind: 'IMAGE' })).toEqual([]);
  });

  it('từ chối giá trị ngoài danh sách', async () => {
    expect(await errorsOf({ content: 'mèo', image_style: 'VAN_GOGH', aspect_ratio: '21:9' }))
      .toEqual(expect.arrayContaining(['image_style', 'aspect_ratio']));
  });
});
```

**Bước 2:** chạy → ĐỎ (2 test đầu xanh sẵn vì `forbidNonWhitelisted` không bật ở `validate` thô; test thứ ba đỏ).

**Bước 3 — code:** trong `phase2.dto.ts`

- Thêm `IsIn` vào dòng import `class-validator`.
- Thêm import: `import { AI_ASPECT_RATIOS, AI_IMAGE_STYLES, AiAspectRatio, AiImageStyle } from './ai-image.options';`
- Trong `CreateAiMessageDto`, sau `attachment_file_id`:

```ts
  /* Chỉ có nghĩa khi `kind = IMAGE`; loại khác thì AiService bỏ qua */
  @IsOptional() @IsIn(AI_IMAGE_STYLES) image_style?: AiImageStyle;
  @IsOptional() @IsIn(AI_ASPECT_RATIOS) aspect_ratio?: AiAspectRatio;
```

**Bước 4:** chạy → XANH.

**Bước 5:**
```bash
git add api/src/phase2/phase2.dto.ts api/src/phase2/ai-message.dto.test.ts
git commit -m "feat(ai): accept image_style and aspect_ratio on AI messages"
```

---

### Việc B3: Nhà cung cấp dùng phong cách và tỷ lệ

**Sửa:** `api/src/phase2/ai-provider.service.ts`, `api/src/phase2/ai-provider.service.spec.ts`

**Bước 1 — test đỏ** (thêm vào cuối `describe('AiProviderService')`):

```ts
  it('Pollinations: tỷ lệ 9:16 ra width/height dọc, phong cách nối vào mô tả', async () => {
    process.env.AI_MOCK = 'false';
    process.env.IMAGE_VENDOR = 'pollinations';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new TextEncoder().encode('x').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'robot', {
      imageStyle: 'THREE_D', aspectRatio: '9:16',
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('width')).toBe('768');
    expect(url.searchParams.get('height')).toBe('1344');
    expect(decodeURIComponent(url.pathname)).toContain('3D render');
    expect(result.metadata).toMatchObject({ width: 768, height: 1344 });
  });

  it('Pollinations: không truyền tuỳ chọn thì vuông 1024 và giữ nguyên mô tả', async () => {
    process.env.AI_MOCK = 'false';
    process.env.IMAGE_VENDOR = 'pollinations';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new TextEncoder().encode('x').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'robot');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('width')).toBe('1024');
    expect(url.searchParams.get('height')).toBe('1024');
    expect(decodeURIComponent(url.pathname)).toBe('/prompt/robot');
  });

  it('Gemini: tỷ lệ đi vào generationConfig.imageConfig.aspectRatio', async () => {
    process.env.AI_MOCK = 'false';
    process.env.GEMINI_API_KEY = 'gemini-key';
    delete process.env.IMAGE_VENDOR;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new AiProviderService().generate(expert, AiMessageKind.IMAGE, 'robot', { aspectRatio: '4:3' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '4:3' });
  });
```

**Bước 2:** chạy `npx vitest run api/src/phase2/ai-provider.service.spec.ts` → ĐỎ (lỗi kiểu `imageStyle` không có trong options; width vẫn 1024).

**Bước 3 — code:**

1. Import đầu file:
```ts
import { AiAspectRatio, AiImageStyle, aspectRatioOf, imageDimensions, imageStyleOf, styledPrompt } from './ai-image.options';
```

2. `AiGenerateOptions` thêm:
```ts
  /* Chỉ dùng cho IMAGE — xem ai-image.options.ts */
  imageStyle?: AiImageStyle;
  aspectRatio?: AiAspectRatio;
```

3. Trong `generate`: `return this.generateImage(input, startedAt, options.signal)` → `return this.generateImage(input, startedAt, options)`.

4. Thay `generateImage`:
```ts
  private generateImage(input: string, startedAt: number, options: AiGenerateOptions): Promise<AiResult> {
    const ratio = aspectRatioOf(options.aspectRatio);
    /* Phong cách ghép vào mô tả ở ĐÂY, một chỗ cho mọi nhà cung cấp */
    const prompt = styledPrompt(input, imageStyleOf(options.imageStyle));
    return this.imageVendor() === 'pollinations'
      ? this.generatePollinationsImage(prompt, ratio, startedAt, options.signal)
      : this.generateGeminiImage(prompt, ratio, startedAt, options.signal);
  }
```

5. `generatePollinationsImage(input, ratio: AiAspectRatio, startedAt, signal?)`:
   - đầu hàm: `const { width, height } = imageDimensions(ratio);`
   - URL: `?width=${width}&height=${height}&nologo=true&model=${encodeURIComponent(model)}`
   - metadata: `width, height,` thay cho `width: 1024, height: 1024,`

6. `generateGeminiImage(input, ratio: AiAspectRatio, startedAt, signal?)`:
   - `generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio } },`
   - metadata: `...imageDimensions(ratio),` thay cho `width: 1024, height: 1024,`

**Bước 4:** chạy → XANH, kể cả 11 test cũ.

**Bước 5:**
```bash
git add api/src/phase2/ai-provider.service.ts api/src/phase2/ai-provider.service.spec.ts
git commit -m "feat(ai): pass image style and aspect ratio through to the image vendors"
```

---

### Việc B4: `summarizeTitle` — AI đặt tên ngắn

**Sửa:** `api/src/phase2/ai-provider.service.ts`, `api/src/phase2/ai-provider.service.spec.ts`

**Bước 1 — test đỏ:**

```ts
  describe('summarizeTitle', () => {
    it('lấy tiêu đề từ model chữ và dọn ngoặc, dấu chấm', async () => {
      process.env.AI_MOCK = 'false';
      process.env.GEMINI_API_KEY = 'gemini-key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '"Robot Mindo 3D".' }] } }] }),
      }));

      await expect(new AiProviderService().summarizeTitle('Tạo robot trợ lý 3D thân thiện')).resolves.toBe('Robot Mindo 3D');
    });

    it('cả hai nhà đều hỏng thì trả null, KHÔNG ném', async () => {
      /* Tiêu đề là bước phụ — ném ra ở đây là đánh sập cả tấm ảnh đã tạo xong */
      process.env.AI_MOCK = 'false';
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.DEEPSEEK_API_KEY = 'ds-key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      await expect(new AiProviderService().summarizeTitle('mèo')).resolves.toBeNull();
    });

    it('chế độ mock không gọi mạng', async () => {
      delete process.env.AI_MOCK;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(new AiProviderService().summarizeTitle('mèo')).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
```

**Bước 2:** chạy → ĐỎ (`summarizeTitle` không tồn tại).

**Bước 3 — code:** import thêm `sanitizeTitle`; thêm phương thức public ngay sau `generate`:

```ts
  /**
   * Tóm mô tả ảnh thành tiêu đề 2–5 chữ.
   *
   * Không bao giờ ném: mọi đường hỏng trả `null`, người gọi lùi về mô tả cắt
   * ngắn đang có. Đi đúng thứ tự nhà cung cấp chữ như `generate`.
   */
  async summarizeTitle(prompt: string, signal?: AbortSignal): Promise<string | null> {
    if (process.env.AI_MOCK !== 'false') return null;
    const systemPrompt = 'Đặt tiêu đề ngắn từ 2 đến 5 chữ cho bức ảnh được mô tả. Giữ ngôn ngữ của mô tả. Chỉ trả về tiêu đề, không ngoặc kép, không dấu chấm.';
    const primary = this.vendor(process.env.LLM_PRIMARY_VENDOR, 'gemini');
    const fallback = this.vendor(process.env.LLM_FALLBACK_VENDOR, 'deepseek');
    for (const vendor of [...new Set<AiVendor>([primary, fallback])]) {
      try {
        const result = vendor === 'gemini'
          ? await this.completeGemini(systemPrompt, prompt, { signal })
          : await this.completeDeepSeek(systemPrompt, prompt, { signal });
        return sanitizeTitle(result.content);
      } catch {
        if (signal?.aborted) return null;
      }
    }
    return null;
  }
```

**Bước 4:** chạy → XANH.

**Bước 5:**
```bash
git add api/src/phase2/ai-provider.service.ts api/src/phase2/ai-provider.service.spec.ts
git commit -m "feat(ai): summarize an image prompt into a short title, never throwing"
```

---

### Việc B5: `sendMessage` lưu tuỳ chọn vào metadata

**Sửa:** `api/src/phase2/ai.service.ts` · **Tạo:** `api/src/phase2/ai.image-options.test.ts`

**Bước 1 — test đỏ:**

```ts
// api/src/phase2/ai.image-options.test.ts
import { Logger } from '@nestjs/common';
import { AiMessageKind, AiMessageRole, AiMessageStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { CreateAiMessageDto } from './phase2.dto';

/**
 * Phong cách và tỷ lệ phải nằm trong metadata của TIN TRẢ LỜI:
 *  - `/retry` chạy lại đúng cài đặt mà không cần client gửi lại;
 *  - mở lại phiên từ Lịch sử vẫn biết vẽ khung theo tỷ lệ nào.
 */
const expert = { id: 'e1', name: 'Lam Anh', capabilities: ['CHAT', 'IMAGE'], isActive: true };
const conversation = { id: 'c1', userId: 'u1', expertId: 'e1', title: 'Tạo ảnh', expert, messages: [] };

function sendHarness() {
  const created: Record<string, unknown>[] = [];
  const tx = {
    aiMessage: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: data.role === 'USER' ? 'm-user' : 'm-bot', ...data });
      }),
    },
    aiConversation: { update: vi.fn(() => Promise.resolve(conversation)) },
  };
  const prisma = {
    aiConversation: { findFirst: () => Promise.resolve(conversation) },
    nftAsset: { count: () => Promise.resolve(0) },
    aiMessage: { count: () => Promise.resolve(0), findFirst: () => Promise.resolve(null), update: vi.fn(() => Promise.resolve({})) },
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  /* Cố ý cho hàng đợi hỏng: hai lệnh create đã chạy xong trước đó, thế là đủ */
  const queue = { add: vi.fn(() => Promise.reject(new Error('stop here'))) } as unknown as Queue;
  const service = new AiService(prisma, {} as AiProviderService, {} as FileStorageService, queue);
  const assistantMetadata = () => created.find((data) => data.role === AiMessageRole.ASSISTANT)?.metadata as Record<string, unknown>;
  return { service, assistantMetadata };
}

beforeEach(() => { vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });

describe('sendMessage — tuỳ chọn ảnh', () => {
  it('ghi phong cách và tỷ lệ vào metadata của tin trả lời', async () => {
    const { service, assistantMetadata } = sendHarness();
    await service.sendMessage('u1', 'c1', { content: 'robot', kind: AiMessageKind.IMAGE, image_style: 'THREE_D', aspect_ratio: '9:16' } as CreateAiMessageDto).catch(() => undefined);
    expect(assistantMetadata()).toMatchObject({ imageStyle: 'THREE_D', aspectRatio: '9:16' });
  });

  it('thiếu thì ghi mặc định, để phiên luôn đọc ra được một tỷ lệ', async () => {
    const { service, assistantMetadata } = sendHarness();
    await service.sendMessage('u1', 'c1', { content: 'robot', kind: AiMessageKind.IMAGE } as CreateAiMessageDto).catch(() => undefined);
    expect(assistantMetadata()).toMatchObject({ imageStyle: 'AUTO', aspectRatio: '1:1' });
  });

  it('tin chữ không mang hai trường này', async () => {
    const { service, assistantMetadata } = sendHarness();
    await service.sendMessage('u1', 'c1', { content: 'chào', image_style: 'THREE_D' } as CreateAiMessageDto).catch(() => undefined);
    expect(assistantMetadata()).not.toHaveProperty('imageStyle');
    expect(assistantMetadata()).not.toHaveProperty('aspectRatio');
  });
});
```

**Bước 2:** `npx vitest run api/src/phase2/ai.image-options.test.ts` → ĐỎ.

**Bước 3 — code:** trong `ai.service.ts`

- Import: `import { aspectRatioOf, imageStyleOf } from './ai-image.options';`
- Trong `sendMessage`, metadata của `assistantMessage`, sau dòng `targetLanguage`:

```ts
            /* Lưu ở tin trả lời để /retry dùng lại và phiên cũ biết tỷ lệ */
            ...(kind === AiMessageKind.IMAGE
              ? { imageStyle: imageStyleOf(dto.image_style), aspectRatio: aspectRatioOf(dto.aspect_ratio) }
              : {}),
```

**Bước 4:** chạy → XANH.

**Bước 5:**
```bash
git add api/src/phase2/ai.service.ts api/src/phase2/ai.image-options.test.ts
git commit -m "feat(ai): store image style and aspect ratio on the pending reply"
```

---

### Việc B6: `processMessage` truyền tuỳ chọn + đặt tiêu đề song song

**Sửa:** `api/src/phase2/ai.service.ts`, `api/src/phase2/ai.image-options.test.ts`

**Bước 1 — test đỏ** (thêm vào `ai.image-options.test.ts`):

```ts
const AUTO_TITLE = 'Tạo robot 3D';

function processHarness(overrides: { kind?: AiMessageKind; title?: string; summarize?: () => Promise<string | null> } = {}) {
  const message = {
    id: 'm-bot', conversationId: 'c1', kind: overrides.kind ?? AiMessageKind.IMAGE, status: AiMessageStatus.PENDING,
    createdAt: new Date(), metadata: { imageStyle: 'THREE_D', aspectRatio: '9:16' },
    conversation: { id: 'c1', userId: 'u1', title: overrides.title ?? AUTO_TITLE, expert },
  };
  const input = { id: 'm-user', role: AiMessageRole.USER, content: AUTO_TITLE, metadata: null, createdAt: new Date() };
  const prisma = {
    aiMessage: {
      findUnique: vi.fn().mockResolvedValueOnce(message).mockResolvedValue({ ...message, status: AiMessageStatus.COMPLETED }),
      findFirst: vi.fn().mockResolvedValue(input),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    aiConversation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const provider = {
    generate: vi.fn().mockResolvedValue({ content: 'Ảnh đã được tạo theo yêu cầu.', metadata: { vendor: 'pollinations' } }),
    summarizeTitle: vi.fn(overrides.summarize ?? (() => Promise.resolve('Robot Mindo 3D'))),
  };
  const service = new AiService(prisma as never, provider as never, {} as never, {} as never);
  return { service, prisma, provider };
}

describe('processMessage — ảnh', () => {
  it('truyền phong cách và tỷ lệ từ metadata xuống nhà cung cấp', async () => {
    const { service, provider } = processHarness();
    await service.processMessage('m-bot');
    expect(provider.generate.mock.calls[0][3]).toMatchObject({ imageStyle: 'THREE_D', aspectRatio: '9:16' });
  });

  it('ảnh đầu tiên: đặt tiêu đề ngắn, chỉ khi tiêu đề vẫn là mô tả cắt ngắn', async () => {
    const { service, prisma } = processHarness();
    await service.processMessage('m-bot');
    expect(prisma.aiConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', title: AUTO_TITLE },
      data: { title: 'Robot Mindo 3D' },
    });
  });

  it('người dùng đã đổi tên thì không gọi đặt tên', async () => {
    const { service, provider, prisma } = processHarness({ title: 'Tên tôi tự đặt' });
    await service.processMessage('m-bot');
    expect(provider.summarizeTitle).not.toHaveBeenCalled();
    expect(prisma.aiConversation.updateMany).not.toHaveBeenCalled();
  });

  it('đặt tên hỏng thì ẢNH VẪN XONG', async () => {
    const { service, prisma } = processHarness({ summarize: () => Promise.reject(new Error('down')) });
    await service.processMessage('m-bot');
    const completed = prisma.aiMessage.updateMany.mock.calls.find(([args]) => args.data.status === AiMessageStatus.COMPLETED);
    expect(completed).toBeDefined();
    expect(prisma.aiConversation.updateMany).not.toHaveBeenCalled();
  });

  it('tin chữ không gọi đặt tên', async () => {
    const { service, provider } = processHarness({ kind: AiMessageKind.CHAT });
    await service.processMessage('m-bot');
    expect(provider.summarizeTitle).not.toHaveBeenCalled();
  });
});
```

**Bước 2:** chạy → ĐỎ.

**Bước 3 — code:** trong `processMessage`

1. Ngay sau `this.activeGenerations.set(messageId, controller);`, TRƯỚC `try`:

```ts
    /*
      Tiêu đề chỉ phụ thuộc mô tả, không phụ thuộc ảnh — nên chạy SONG SONG
      với việc tạo ảnh. Model chữ xong trước model ảnh, thành ra không cộng
      thêm độ trễ nào. Điều kiện "tiêu đề vẫn là mô tả cắt ngắn" nghĩa là:
      đây là ảnh đầu của phiên (hoặc lần đầu chưa đặt được), và người dùng
      chưa tự đổi tên.
    */
    const autoTitle = input.content.trim().slice(0, 70);
    const titlePromise = message.kind === AiMessageKind.IMAGE && message.conversation.title === autoTitle
      ? this.provider.summarizeTitle(input.content, controller.signal).catch(() => null)
      : Promise.resolve(null);
```

2. Trong lời gọi `this.provider.generate(...)`, thêm vào options:

```ts
        imageStyle: imageStyleOf(metadata.imageStyle),
        aspectRatio: aspectRatioOf(metadata.aspectRatio),
```

3. Ngay TRƯỚC khối `const updated = await this.prisma.aiMessage.updateMany({ ... status: COMPLETED ...`:

```ts
      /*
        Ghi tiêu đề TRƯỚC khi đánh dấu xong: khung SSE cuối cùng (khung báo
        xong) đọc lại cả hội thoại, nên tiêu đề mới đi kèm ngay khung đó thay
        vì app phải nạp thêm một lần. `where` kèm tiêu đề cũ để không đè lên
        tên người dùng vừa đổi trong lúc chờ.
      */
      const shortTitle = await titlePromise;
      if (shortTitle) {
        await this.prisma.aiConversation
          .updateMany({ where: { id: message.conversationId, title: autoTitle }, data: { title: shortTitle } })
          .catch(() => undefined);
      }
```

**Bước 4:** chạy → XANH. Chạy luôn `npx vitest run api/src/phase2` → mọi test trong thư mục xanh.

**Bước 5:**
```bash
git add api/src/phase2/ai.service.ts api/src/phase2/ai.image-options.test.ts
git commit -m "feat(ai): generate images with the stored options and title the session in parallel"
```

---

### Việc B7: Tài liệu API

**Sửa:** `docs/ai-chat-api.md` — ở mục gửi tin (`POST investor/ai/conversations/:id/messages`) thêm:

```md
| `image_style`  | tuỳ chọn, chỉ cho `kind = IMAGE` | `AUTO` (mặc định) · `NATURAL` · `THREE_D` · `ILLUSTRATION` |
| `aspect_ratio` | tuỳ chọn, chỉ cho `kind = IMAGE` | `1:1` (mặc định) · `4:3` · `9:16` |

Hai giá trị được lưu ở `metadata.imageStyle` / `metadata.aspectRatio` của tin trả lời.
`/retry` dùng lại đúng cài đặt đó.

Ảnh đầu tiên của phiên: server tóm mô tả thành tiêu đề 2–5 chữ và ghi vào
`title` của hội thoại, trước khi tin chuyển `COMPLETED`. Đặt tên hỏng không làm
hỏng ảnh — tiêu đề giữ nguyên là mô tả cắt ngắn.

Nhà tạo ảnh chọn bằng env `IMAGE_VENDOR` (`gemini` mặc định · `pollinations`).
```

```bash
git add docs/ai-chat-api.md
git commit -m "docs(ai): image style, aspect ratio and auto title"
```

### Việc B8: Kiểm tra toàn bộ backend

```bash
cd /Users/Work_home/Project_Hungs/Mindo/Mindo-API
npx tsc --noEmit -p api/tsconfig.json     # mong đợi: không in gì
npx vitest run                            # mong đợi: tất cả xanh (324 + ~19 test mới)
```

Chạy thật qua API cục bộ (API đang chạy với `IMAGE_VENDOR=pollinations`):

```bash
# gửi ảnh 9:16 phong cách 3D, chờ COMPLETED, kiểm:
#  - metadata.aspectRatio = "9:16", metadata.height = 1344
#  - title hội thoại đổi thành tên ngắn
#  - file ảnh tải được, JPEG dọc
```

---

# PHẦN C — App (Mindo-App)

### Việc C1: Kiểu dữ liệu phiên ảnh + gửi tuỳ chọn

**Sửa:** `src/services/aiChatApi.ts`, `src/services/__tests__/aiChatApi.test.ts`

**Bước 1 — test đỏ** (thêm import `getImageSession`, `toImageSession`; thêm khối cuối file):

```ts
describe('phiên tạo ảnh', () => {
  const user = (id: string, content: string) =>
    rawMessage({id, role: 'USER', kind: 'IMAGE', status: 'COMPLETED', content});
  const bot = (id: string, over: Record<string, unknown> = {}) =>
    rawMessage({id, role: 'ASSISTANT', kind: 'IMAGE', ...over});

  it('ghép mỗi ảnh với mô tả NGAY TRƯỚC nó', () => {
    const session = toImageSession(
      rawConversation({
        title: 'Robot Mindo 3D',
        messages: [
          user('u1', 'robot'),
          bot('a1', {attachmentUrl: 'https://x/1.jpg', metadata: {imageStyle: 'THREE_D', aspectRatio: '9:16'}}),
          user('u2', 'robot đỏ'),
          bot('a2', {status: 'FAILED'}),
        ],
      }) as never,
    );

    expect(session.title).toBe('Robot Mindo 3D');
    expect(session.generations).toEqual([
      {messageId: 'a1', prompt: 'robot', style: 'THREE_D', aspectRatio: '9:16', status: 'done', uri: 'https://x/1.jpg'},
      {messageId: 'a2', prompt: 'robot đỏ', style: 'AUTO', aspectRatio: '1:1', status: 'failed', uri: undefined},
    ]);
  });

  it('dịch đủ bốn trạng thái', () => {
    const statuses = (['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const).map(
      status => toImageSession(rawConversation({messages: [user('u', 'x'), bot('a', {status, attachmentUrl: 'u'})]}) as never).generations[0].status,
    );
    expect(statuses).toEqual(['pending', 'done', 'failed', 'cancelled']);
  });

  it('COMPLETED mà không có file thì coi là hỏng, không vẽ khung ảnh trống', () => {
    const [g] = toImageSession(rawConversation({messages: [user('u', 'x'), bot('a', {attachmentUrl: null})]}) as never).generations;
    expect(g.status).toBe('failed');
  });

  it('bỏ qua tin không phải ảnh', () => {
    const session = toImageSession(
      rawConversation({messages: [rawMessage({id: 'c', role: 'ASSISTANT', kind: 'CHAT'})]}) as never,
    );
    expect(session.generations).toEqual([]);
  });

  it('getImageSession đọc đúng hội thoại', async () => {
    mockedGet.mockResolvedValue(okResponse(rawConversation({id: 'c7'})));
    const session = await getImageSession('c7');
    expect(mockedGet).toHaveBeenCalledWith('investor/ai/conversations/c7');
    expect(session.id).toBe('c7');
  });

  it('gửi ảnh kèm phong cách và tỷ lệ', async () => {
    mockedPost.mockResolvedValue(okResponse({user_message: rawMessage({role: 'USER'}), assistant_message: rawMessage({status: 'PENDING'})}));
    await sendMessage('c1', 'robot', {kind: 'image', imageStyle: 'THREE_D', aspectRatio: '9:16'});
    expect(mockedPost).toHaveBeenCalledWith('investor/ai/conversations/c1/messages', {
      content: 'robot', kind: 'IMAGE', image_style: 'THREE_D', aspect_ratio: '9:16',
    });
  });

  it('không truyền thì KHÔNG gửi hai trường — tin chữ giữ nguyên thân như cũ', async () => {
    mockedPost.mockResolvedValue(okResponse({user_message: rawMessage({role: 'USER'}), assistant_message: rawMessage({status: 'PENDING'})}));
    await sendMessage('c1', 'chào');
    expect(mockedPost).toHaveBeenCalledWith('investor/ai/conversations/c1/messages', {content: 'chào', kind: 'CHAT'});
  });
});
```

**Bước 2:** `npx jest src/services/__tests__/aiChatApi.test.ts` → ĐỎ.

**Bước 3 — code** trong `aiChatApi.ts`:

1. Sau khối kiểu `AiExpert`:

```ts
/* ------------------------------------------------------------------ *
 * Phiên tạo ảnh — màn Tạo ảnh (Figma 1166:4089 → 3837)
 * ------------------------------------------------------------------ */

/** Khớp `AI_IMAGE_STYLES` bên `Mindo-API/api/src/phase2/ai-image.options.ts` */
export type ImageStyle = 'AUTO' | 'NATURAL' | 'THREE_D' | 'ILLUSTRATION';
export const IMAGE_STYLES: ImageStyle[] = ['AUTO', 'NATURAL', 'THREE_D', 'ILLUSTRATION'];

export type AspectRatio = '1:1' | '4:3' | '9:16';
export const ASPECT_RATIOS: AspectRatio[] = ['1:1', '4:3', '9:16'];

export type GenerationStatus = 'pending' | 'done' | 'failed' | 'cancelled';

/** Một lần tạo ảnh = một cặp {mô tả của người dùng, tin trả lời} */
export interface ImageGeneration {
  /** Id tin TRẢ LỜI — `/stop`, `/retry` và SSE đều nhận id này */
  messageId: string;
  prompt: string;
  style: ImageStyle;
  aspectRatio: AspectRatio;
  status: GenerationStatus;
  uri?: string;
}

export interface ImageSession {
  id: string;
  title: string;
  /** Cũ → mới. Màn Tạo ảnh vẽ cái cuối; màn Xem lớn vuốt qua tất cả */
  generations: ImageGeneration[];
}
```

2. Sau `toMessage`:

```ts
const GENERATION_STATUS: Record<BeMessageStatus, GenerationStatus> = {
  PENDING: 'pending',
  COMPLETED: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const styleOf = (value: unknown): ImageStyle =>
  IMAGE_STYLES.includes(value as ImageStyle) ? (value as ImageStyle) : 'AUTO';

const ratioOf = (value: unknown): AspectRatio =>
  ASPECT_RATIOS.includes(value as AspectRatio) ? (value as AspectRatio) : '1:1';

/**
 * Hội thoại của BE → phiên ảnh.
 *
 * Mô tả của một ảnh là tin người dùng NGAY TRƯỚC nó: một phiên có nhiều lần
 * "Tạo lại" / "Sửa mô tả", mỗi lần là một cặp hỏi–đáp mới.
 *
 * Phiên ảnh cũ (tạo từ màn chat) không có `imageStyle`/`aspectRatio` trong
 * metadata → lùi về "Theo mô tả", 1:1 — đúng như chúng đã được tạo ra.
 */
export function toImageSession(raw: RawConversation): ImageSession {
  const generations: ImageGeneration[] = [];
  let prompt = '';
  for (const msg of raw.messages ?? []) {
    if (msg.role === 'USER') {
      prompt = msg.content;
      continue;
    }
    if (msg.kind !== 'IMAGE') {
      continue;
    }
    const uri = msg.attachmentUrl ?? undefined;
    const status = GENERATION_STATUS[msg.status] ?? 'failed';
    generations.push({
      messageId: msg.id,
      prompt,
      style: styleOf(msg.metadata?.imageStyle),
      aspectRatio: ratioOf(msg.metadata?.aspectRatio),
      /* Xong mà không có file thì vẽ khung ảnh trống là nói dối — coi như hỏng */
      status: status === 'done' && !uri ? 'failed' : status,
      uri,
    });
  }
  return {id: raw.id, title: raw.title, generations};
}

export async function getImageSession(sessionId: string): Promise<ImageSession> {
  const response = await apiClient.get<Envelope<RawConversation>>(
    `investor/ai/conversations/${sessionId}`,
  );
  return toImageSession(unwrapData(response));
}
```

3. `aiChatKeys` thêm:
```ts
  imageSession: (sessionId: string) => ['ai-chat', 'image-session', sessionId] as const,
```

4. `sendMessage` — kiểu options thêm `imageStyle?: ImageStyle; aspectRatio?: AspectRatio;`, thân request thêm sau `target_language`:
```ts
      ...(options.imageStyle ? {image_style: options.imageStyle} : {}),
      ...(options.aspectRatio ? {aspect_ratio: options.aspectRatio} : {}),
```

**Bước 4:** chạy → XANH.

**Bước 5:**
```bash
git add src/services/aiChatApi.ts src/services/__tests__/aiChatApi.test.ts
git commit -m "feat(ai-image): read an image session and send style and aspect ratio"
```

---

### Việc C2: Lưu ảnh vào thư viện Ảnh

**Tạo:** `src/services/savePhoto.ts`, `src/services/__tests__/savePhoto.test.ts` · **Sửa:** `package.json`, `ios/Podfile.lock`, `ios/ProjectName/Info.plist`, `jest.setup.js`

**Bước 1 — cài thư viện** (bắt buộc kèm `pod install`, thiếu là build iphoneos hỏng):

```bash
cd /Users/Work_home/Project_Hungs/Mindo/Mindo-App
yarn add @react-native-camera-roll/camera-roll@^7.10.2
cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install && cd ..
```

**Bước 2 — Info.plist**, cạnh `NSPhotoLibraryUsageDescription`:

```xml
	<key>NSPhotoLibraryAddUsageDescription</key>
	<string>Mindo cần quyền lưu ảnh để tải hình ảnh AI đã tạo về máy của bạn.</string>
```

**Bước 3 — mock toàn cục** trong `jest.setup.js`:

```js
jest.mock('@react-native-camera-roll/camera-roll', () => ({
  CameraRoll: {saveAsset: jest.fn().mockResolvedValue({})},
}));
```

**Bước 4 — test đỏ:**

```ts
// src/services/__tests__/savePhoto.test.ts
import {CameraRoll} from '@react-native-camera-roll/camera-roll';
import ReactNativeBlobUtil from 'react-native-blob-util';

import {PhotoPermissionError, saveImageToPhotos} from '@/services/savePhoto';

jest.mock('react-native-blob-util', () => {
  const fetchMock = jest.fn();
  return {
    __esModule: true,
    default: {
      config: jest.fn(() => ({fetch: fetchMock})),
      fs: {
        dirs: {CacheDir: '/cache'},
        writeFile: jest.fn().mockResolvedValue(undefined),
        unlink: jest.fn().mockResolvedValue(undefined),
      },
      __fetch: fetchMock,
    },
  };
});

const blob = ReactNativeBlobUtil as unknown as {
  fs: {writeFile: jest.Mock; unlink: jest.Mock};
  __fetch: jest.Mock;
};
const saveAsset = CameraRoll.saveAsset as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('saveImageToPhotos', () => {
  it('URL https: tải về bộ nhớ tạm rồi lưu, xong dọn file tạm', async () => {
    blob.__fetch.mockResolvedValue({info: () => ({status: 200}), path: () => '/cache/a.jpg'});

    await saveImageToPhotos('https://api/files/1/content?sig=x');

    expect(saveAsset).toHaveBeenCalledWith('/cache/a.jpg', {type: 'photo'});
    expect(blob.fs.unlink).toHaveBeenCalledWith('/cache/a.jpg');
  });

  it('data URI: ghi base64 ra file, đuôi theo mime', async () => {
    await saveImageToPhotos('data:image/png;base64,aGVsbG8=');

    const [path, content, encoding] = blob.fs.writeFile.mock.calls[0];
    expect(path).toMatch(/^\/cache\/mindo-ai-\d+\.png$/);
    expect(content).toBe('aGVsbG8=');
    expect(encoding).toBe('base64');
    expect(saveAsset).toHaveBeenCalledWith(path, {type: 'photo'});
  });

  it('server trả lỗi thì không gọi lưu', async () => {
    blob.__fetch.mockResolvedValue({info: () => ({status: 404}), path: () => '/cache/x', flush: jest.fn()});
    await expect(saveImageToPhotos('https://api/files/gone')).rejects.toThrow();
    expect(saveAsset).not.toHaveBeenCalled();
  });

  it('bị từ chối quyền thì ném PhotoPermissionError để màn hình báo đúng cách sửa', async () => {
    blob.__fetch.mockResolvedValue({info: () => ({status: 200}), path: () => '/cache/a.jpg'});
    saveAsset.mockRejectedValueOnce(new Error('User denied access to photo library'));

    await expect(saveImageToPhotos('https://api/x')).rejects.toBeInstanceOf(PhotoPermissionError);
  });

  it('SVG (ảnh mẫu của chế độ mock) không lưu được vào Ảnh', async () => {
    await expect(saveImageToPhotos('data:image/svg+xml;base64,PHN2Zz4=')).rejects.toThrow();
    expect(saveAsset).not.toHaveBeenCalled();
  });
});
```

**Bước 5:** `npx jest src/services/__tests__/savePhoto.test.ts` → ĐỎ.

**Bước 6 — code:**

```ts
// src/services/savePhoto.ts
import {CameraRoll} from '@react-native-camera-roll/camera-roll';
import ReactNativeBlobUtil from 'react-native-blob-util';

/**
 * Lưu một ảnh AI vào thư viện Ảnh của máy.
 *
 * `CameraRoll.saveAsset` chỉ nhận đường dẫn file cục bộ, mà ảnh AI đến dưới
 * hai dạng: URL https có chữ ký (file lưu trên server) hoặc `data:` URI (một
 * số nhà cung cấp trả thẳng). Nên luôn đi qua một file tạm, và luôn dọn nó.
 */
export class PhotoPermissionError extends Error {
  constructor() {
    super('Chưa được cấp quyền lưu ảnh');
    this.name = 'PhotoPermissionError';
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

async function toLocalFile(uri: string): Promise<string> {
  if (uri.startsWith('data:')) {
    const [head, base64 = ''] = uri.split(',', 2);
    const mime = head.slice(5).split(';')[0];
    const ext = EXT_BY_MIME[mime];
    /* SVG chỉ xuất hiện ở chế độ mock; thư viện Ảnh không nhận vector */
    if (!ext) {
      throw new Error('Định dạng ảnh này không lưu vào thư viện Ảnh được.');
    }
    const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/mindo-ai-${Date.now()}.${ext}`;
    await ReactNativeBlobUtil.fs.writeFile(path, base64, 'base64');
    return path;
  }

  const response = await ReactNativeBlobUtil.config({
    fileCache: true,
    appendExt: 'jpg',
  }).fetch('GET', uri);
  const status = response.info().status;
  if (status < 200 || status >= 300) {
    /* blob-util tạo file kể cả khi server trả lỗi — dọn đi */
    await response.flush?.();
    throw new Error('Không tải được ảnh.');
  }
  return response.path();
}

export async function saveImageToPhotos(uri: string): Promise<void> {
  const path = await toLocalFile(uri);
  try {
    await CameraRoll.saveAsset(path, {type: 'photo'});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/denied|permission|not authori[sz]ed|access/i.test(message)) {
      throw new PhotoPermissionError();
    }
    throw error;
  } finally {
    await ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined);
  }
}
```

**Bước 7:** chạy → XANH.

**Bước 8:**
```bash
git add package.json yarn.lock ios/Podfile.lock ios/ProjectName/Info.plist jest.setup.js \
  src/services/savePhoto.ts src/services/__tests__/savePhoto.test.ts
git commit -m "feat(ai-image): save generated images to the photo library"
```

---

### Việc C3: Chuỗi hiển thị và màu

**Sửa:** `src/i18n/vi.ts`, `src/i18n/en.ts`, `src/i18n/BaseLanguage.ts`, `src/styles/screenTokens.ts`

Thêm vào nhóm `ai` (sau `retry_answer`). `BaseLanguage.ts` thêm cùng các khoá với kiểu `string`.

| Khoá | vi | en |
|---|---|---|
| `image_title` | Tạo ảnh | Create image |
| `image_hero` | Biến ý tưởng\nthành hình ảnh. | Turn ideas\ninto images. |
| `image_prompt_label` | Mô tả hình ảnh | Image description |
| `image_prompt_placeholder` | Mô tả hình ảnh bạn muốn tạo... | Describe the image you want... |
| `image_style_label` | Phong cách | Style |
| `image_optional` | (tùy chọn) | (optional) |
| `image_style_auto` | Theo mô tả | As described |
| `image_style_natural` | Tự nhiên | Natural |
| `image_style_3d` | 3D | 3D |
| `image_style_illustration` | Minh họa | Illustration |
| `image_ratio_label` | Tỷ lệ ảnh | Aspect ratio |
| `image_generate` | Tạo hình ảnh | Create image |
| `image_generating` | Đang tạo hình ảnh... | Creating image... |
| `image_generating_desc` | Ý tưởng của bạn đang thành hình. | Your idea is taking shape. |
| `image_cancel` | Hủy tạo ảnh | Cancel |
| `image_edit_prompt` | Sửa mô tả | Edit description |
| `image_used_prompt` | Mô tả đã dùng | Description used |
| `image_save` | Tải hình ảnh | Save image |
| `image_failed_title` | Chưa tạo được hình ảnh | Couldn't create the image |
| `image_failed_desc` | Đã có lỗi khi xử lý yêu cầu.\nMô tả của bạn vẫn được giữ lại. | Something went wrong.\nYour description has been kept. |
| `image_saved_title` | Đã lưu ảnh | Image saved |
| `image_saved_desc` | Ảnh đã được lưu vào thư viện Ảnh. | Saved to your photo library. |
| `image_save_failed_title` | Không lưu được ảnh | Couldn't save the image |
| `image_permission_desc` | Hãy cho phép Mindo lưu ảnh trong Cài đặt. | Allow Mindo to save photos in Settings. |
| `image_send_failed_title` | Không gửi được yêu cầu | Couldn't send the request |
| `image_close` | Đóng | Close |

Dùng lại khoá có sẵn: `image_regenerate` ("Tạo lại"), `retry_answer` ("Thử lại"), `history`.

`screenColor` thêm (đo từ ảnh Figma):

```ts
  /** Màn Xem lớn — 1166:3817 */
  aiViewerBg: '#07172D',
  aiViewerButton: '#21334B',
  aiViewerCounter: '#8B9DB3',
  /** Chip tỷ lệ đang chọn — 1166:4123 */
  aiChipSelectedSoft: '#F1F6DA',
```

Kiểm: `npx tsc --noEmit` → 0 lỗi.

```bash
git add src/i18n src/styles/screenTokens.ts
git commit -m "feat(ai-image): strings and colors for the image screen"
```

---

### Việc C4: Logic trạng thái (hàm thuần)

**Tạo:** `src/screens/ImageGenScreen/imageGenState.ts`, `src/screens/ImageGenScreen/__tests__/imageGenState.test.ts`

**Bước 1 — test đỏ:**

```ts
import {ImageGeneration, ImageSession} from '@/services/aiChatApi';
import {
  doneGenerations, frameAspect, latestGeneration, phaseOf, withPendingGeneration,
} from '../imageGenState';

const gen = (over: Partial<ImageGeneration> = {}): ImageGeneration => ({
  messageId: 'a1', prompt: 'robot', style: 'AUTO', aspectRatio: '1:1', status: 'done', uri: 'https://x/1.jpg', ...over,
});
const session = (...generations: ImageGeneration[]): ImageSession => ({id: 'c1', title: 'Robot', generations});

describe('phaseOf', () => {
  it('chưa có phiên hoặc chưa có ảnh nào → form', () => {
    expect(phaseOf(undefined, false)).toBe('form');
    expect(phaseOf(session(), false)).toBe('form');
  });

  it('suy từ ảnh CUỐI, không phải ảnh đầu', () => {
    expect(phaseOf(session(gen({status: 'failed'}), gen({messageId: 'a2', status: 'pending'})), false)).toBe('generating');
  });

  it('bốn trạng thái của ảnh cuối', () => {
    expect(phaseOf(session(gen({status: 'pending'})), false)).toBe('generating');
    expect(phaseOf(session(gen({status: 'done'})), false)).toBe('result');
    expect(phaseOf(session(gen({status: 'failed'})), false)).toBe('error');
    /* Hủy xong thì về form để sửa tiếp, không phải màn lỗi */
    expect(phaseOf(session(gen({status: 'cancelled'})), false)).toBe('form');
  });

  it('đang sửa mô tả thì luôn là form', () => {
    expect(phaseOf(session(gen({status: 'done'})), true)).toBe('form');
  });
});

describe('các hàm phụ', () => {
  it('latestGeneration lấy cái cuối', () => {
    expect(latestGeneration(session(gen(), gen({messageId: 'a2'})))?.messageId).toBe('a2');
    expect(latestGeneration(undefined)).toBeUndefined();
  });

  it('frameAspect là rộng / cao', () => {
    expect(frameAspect('1:1')).toBe(1);
    expect(frameAspect('4:3')).toBeCloseTo(4 / 3);
    expect(frameAspect('9:16')).toBeCloseTo(9 / 16);
  });

  it('doneGenerations chỉ giữ ảnh đã xong và có file', () => {
    const list = doneGenerations(session(gen(), gen({messageId: 'a2', status: 'failed'}), gen({messageId: 'a3'})));
    expect(list.map(g => g.messageId)).toEqual(['a1', 'a3']);
  });

  it('withPendingGeneration nối ảnh đang chờ để màn chuyển trạng thái NGAY, không đợi mạng', () => {
    const next = withPendingGeneration(session(gen()), 'c1', {messageId: 'a2', prompt: 'robot đỏ', style: 'THREE_D', aspectRatio: '9:16'});
    expect(next.generations.at(-1)).toEqual({messageId: 'a2', prompt: 'robot đỏ', style: 'THREE_D', aspectRatio: '9:16', status: 'pending'});
    expect(withPendingGeneration(undefined, 'c9', {messageId: 'a1', prompt: 'x', style: 'AUTO', aspectRatio: '1:1'}).id).toBe('c9');
  });
});
```

**Bước 2:** chạy → ĐỎ.

**Bước 3 — code:**

```ts
// src/screens/ImageGenScreen/imageGenState.ts
import {AspectRatio, ImageGeneration, ImageSession} from '@/services/aiChatApi';

/**
 * Màn Tạo ảnh có bốn trạng thái (Figma 16/17/18/20), nhưng KHÔNG giữ trạng
 * thái riêng — nó suy ra từ tin cuối của phiên. Nhờ vậy mở lại phiên từ Lịch
 * sử, quay lại sau khi app bị tắt, hay máy khác vừa hủy hộ đều tự đúng mà
 * không phải đồng bộ hai nguồn sự thật.
 *
 * Ngoại lệ duy nhất là `editing`: người dùng chủ động bấm "Sửa mô tả".
 */
export type ImageGenPhase = 'form' | 'generating' | 'result' | 'error';

export const latestGeneration = (session?: ImageSession) =>
  session?.generations[session.generations.length - 1];

export function phaseOf(session: ImageSession | undefined, editing: boolean): ImageGenPhase {
  if (editing) {
    return 'form';
  }
  const last = latestGeneration(session);
  switch (last?.status) {
    case 'pending':
      return 'generating';
    case 'done':
      return 'result';
    case 'failed':
      return 'error';
    default:
      /* chưa có ảnh, hoặc vừa hủy: về form, mô tả được điền lại */
      return 'form';
  }
}

/** Rộng / cao — dùng cho `aspectRatio` của khung ảnh */
export function frameAspect(ratio: AspectRatio): number {
  const [w, h] = ratio.split(':').map(Number);
  return w / h;
}

export const doneGenerations = (session?: ImageSession) =>
  (session?.generations ?? []).filter(g => g.status === 'done' && !!g.uri);

/**
 * Nối một ảnh đang chờ vào cache ngay khi BE nhận yêu cầu.
 *
 * Không có bước này thì giữa lúc bấm "Tạo hình ảnh" và lúc nạp lại phiên,
 * màn vẫn ở form — người dùng tưởng chưa bấm được và bấm lần nữa.
 */
export function withPendingGeneration(
  prev: ImageSession | undefined,
  sessionId: string,
  gen: Omit<ImageGeneration, 'status' | 'uri'>,
): ImageSession {
  return {
    id: prev?.id ?? sessionId,
    title: prev?.title ?? '',
    generations: [...(prev?.generations ?? []), {...gen, status: 'pending'}],
  };
}
```

**Bước 4:** chạy → XANH.

**Bước 5:**
```bash
git add src/screens/ImageGenScreen/imageGenState.ts src/screens/ImageGenScreen/__tests__/imageGenState.test.ts
git commit -m "feat(ai-image): derive the screen phase from the session's last image"
```

---

### Việc C5: Các khối giao diện

**Tạo** trong `src/screens/ImageGenScreen/`:
`imageGenMetrics.ts`, `components/GeneratedImage.tsx`, `components/ImageFrame.tsx`, `components/OptionChip.tsx`, `components/PromptCard.tsx`, `components/FooterButton.tsx`, `components/PromptForm.tsx`, `components/GeneratingView.tsx`, `components/ResultView.tsx`, `components/ErrorView.tsx`

Đây là việc giao diện thuần, được kiểm ở Việc C6 qua màn hoàn chỉnh. Không có test riêng cho từng khối.

```ts
// imageGenMetrics.ts
/** Số đo Figma 1166:4089 → 3837 (khung 393). Xem bảng ở đầu kế hoạch. */
export const imageGenMetrics = {
  side: 24,
  contentWidth: 345,
  dividerToContent: 31,
  heroLineHeight: 34,
  labelGap: 8,
  sectionGap: 37,
  fieldHeight: 141,
  fieldRadius: 16,
  fieldPadding: 16,
  chipHeight: 43,
  chipRadius: 14,
  chipColGap: 16,
  chipRowGap: 9,
  ratioGap: 11,
  frameRadius: 20,
  cardRadius: 16,
  cardPadding: 16,
  buttonHeight: 52,
  buttonRadius: 16,
  /* đáy nút cách mép màn 56 = safe-area 34 + 22 */
  footerGap: 22,
  actionHeight: 44,
  sparkleCircle: 56,
  errorCircle: 76,
  viewerButton: 36,
};
```

```tsx
// components/GeneratedImage.tsx
import React from 'react';
import {Image} from 'react-native';
import {SvgXml} from 'react-native-svg';

import {ensureSvgViewBox, isSvgDataUri, svgFromDataUri} from '@/services/aiChatApi';

interface Props {
  uri: string;
  width: number;
  height: number;
}

/**
 * Ảnh AI: raster (https hoặc data URI) đi `Image`, SVG data URI đi `SvgXml`.
 * `Image` của iOS không vẽ được SVG — trả khung trống mà không báo lỗi.
 */
const GeneratedImage: React.FC<Props> = ({uri, width, height}) =>
  isSvgDataUri(uri) ? (
    <SvgXml xml={ensureSvgViewBox(svgFromDataUri(uri))} width={width} height={height} />
  ) : (
    <Image source={{uri}} resizeMode={'cover'} style={{width, height}} />
  );

export default GeneratedImage;
```

```tsx
// components/ImageFrame.tsx
import React from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {Circle} from 'react-native-svg';

import {screenColor} from '@/styles/screenTokens';
import {imageGenMetrics as m} from '../imageGenMetrics';

interface Props {
  width: number;
  height: number;
  radius?: number;
  children?: React.ReactNode;
}

/**
 * Khung ảnh nền lime với hai vòng trang trí — dùng chung cho Đang tạo, Kết
 * quả và Xem lớn. Vị trí vòng tính theo TỶ LỆ khung, để khung 4:3 hay 9:16
 * vẫn giống bố cục Figma vẽ cho khung vuông.
 */
const ImageFrame: React.FC<Props> = ({width, height, radius = m.frameRadius, children}) => {
  const unit = Math.min(width, height);
  return (
    <View
      style={[
        styles.frame,
        {width, height, borderRadius: radius, backgroundColor: screenColor.aiImageBg},
      ]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Circle cx={width * 0.73} cy={height * 0.25} r={unit * 0.2} fill={screenColor.aiImageDecoTop} />
        <Circle cx={width * 0.25} cy={height * 0.73} r={unit * 0.25} fill={screenColor.aiImageDecoBottom} />
      </Svg>
      {children}
    </View>
  );
};

export default ImageFrame;

const styles = StyleSheet.create({
  frame: {overflow: 'hidden', alignItems: 'center', justifyContent: 'center'},
});
```

```tsx
// components/OptionChip.tsx
import React from 'react';
import {Pressable, StyleSheet} from 'react-native';

import AppText from '@/components/AppText/AppText';
import {screenColor} from '@/styles/screenTokens';
import {useTheme} from '@/styles/theme/ThemeProvider';
import {imageGenMetrics as m} from '../imageGenMetrics';

interface Props {
  label: string;
  selected: boolean;
  /** `solid`: chip phong cách (chọn = nền navy) · `soft`: chip tỷ lệ (chọn = nền lime nhạt + viền lime) */
  variant: 'solid' | 'soft';
  onPress: () => void;
  testID?: string;
}

const OptionChip: React.FC<Props> = ({label, selected, variant, onPress, testID}) => {
  const {colors} = useTheme();
  const solidOn = variant === 'solid' && selected;
  const softOn = variant === 'soft' && selected;
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole={'button'}
      accessibilityState={{selected}}
      style={({pressed}) => [
        styles.chip,
        {
          backgroundColor: solidOn ? colors.text.label : softOn ? screenColor.aiChipSelectedSoft : colors.bg.surface,
          borderColor: solidOn ? colors.text.label : softOn ? screenColor.aiSparkle : screenColor.aiFieldBorder,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <AppText style={[styles.label, {color: solidOn ? colors.util.white : colors.text.label}]}>{label}</AppText>
    </Pressable>
  );
};

export default OptionChip;

const styles = StyleSheet.create({
  chip: {
    flex: 1,
    height: m.chipHeight,
    borderRadius: m.chipRadius,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {fontSize: 14, lineHeight: 22, fontWeight: '500'},
});
```

```tsx
// components/PromptCard.tsx
import React from 'react';
import {StyleSheet, View} from 'react-native';

import AppText from '@/components/AppText/AppText';
import {screenColor} from '@/styles/screenTokens';
import {useTheme} from '@/styles/theme/ThemeProvider';
import {imageGenMetrics as m} from '../imageGenMetrics';

/** Thẻ nền xám nhạt chứa mô tả — `muted` là bản "Mô tả đã dùng" (chữ 13 xám) */
const PromptCard: React.FC<{text: string; muted?: boolean}> = ({text, muted}) => {
  const {colors} = useTheme();
  return (
    <View style={[styles.card, {backgroundColor: screenColor.aiSoftFill}]}>
      <AppText
        style={[
          muted ? styles.muted : styles.body,
          {color: muted ? screenColor.textBody : colors.text.label},
        ]}>
        {text}
      </AppText>
    </View>
  );
};

export default PromptCard;

const styles = StyleSheet.create({
  card: {borderRadius: m.cardRadius, padding: m.cardPadding},
  body: {fontSize: 14, lineHeight: 24},
  muted: {fontSize: 13, lineHeight: 22},
});
```

```tsx
// components/FooterButton.tsx
import React from 'react';
import {Pressable, StyleSheet} from 'react-native';

import AppText from '@/components/AppText/AppText';
import {screenColor} from '@/styles/screenTokens';
import {useTheme} from '@/styles/theme/ThemeProvider';
import {imageGenMetrics as m} from '../imageGenMetrics';

interface Props {
  label: string;
  onPress: () => void;
  /** `primary` nền navy · `soft` nền xám nhạt (Hủy tạo ảnh, Sửa mô tả ở màn lỗi) */
  tone?: 'primary' | 'soft';
  disabled?: boolean;
  testID?: string;
}

const FooterButton: React.FC<Props> = ({label, onPress, tone = 'primary', disabled, testID}) => {
  const {colors} = useTheme();
  const primary = tone === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole={'button'}
      accessibilityState={{disabled: !!disabled}}
      style={({pressed}) => [
        styles.button,
        {
          backgroundColor: primary ? colors.text.label : screenColor.aiSoftFill,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}>
      <AppText style={[styles.label, {color: primary ? colors.util.white : colors.text.label}]}>{label}</AppText>
    </Pressable>
  );
};

export default FooterButton;

const styles = StyleSheet.create({
  button: {
    height: m.buttonHeight,
    borderRadius: m.buttonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {fontSize: 15, lineHeight: 19, fontWeight: '700'},
});
```

`PromptForm.tsx`, `GeneratingView.tsx`, `ResultView.tsx`, `ErrorView.tsx` — mỗi cái là **một thân cuộn + chân cố định**:

```tsx
<View style={{flex: 1}}>
  <ScrollView contentContainerStyle={{paddingHorizontal: m.side, paddingTop: <khoảng cách Figma>, paddingBottom: 24}}>
    …nội dung…
  </ScrollView>
  <View style={{paddingHorizontal: m.side, paddingBottom: bottomInset + m.footerGap}}>
    …nút chân…
  </View>
</View>
```

`bottomInset = Math.max(insets.bottom, 12)`, truyền từ màn cha.

| Khối | Props | Nội dung (testID) |
|---|---|---|
| `PromptForm` | `prompt, onChangePrompt, style, onChangeStyle, ratio, onChangeRatio, onSubmit, submitting, bottomInset` | hero `t.ai.image_hero` bold 25 lh 34 · nhãn + ô `TextInput` multiline (`image-prompt-input`, `maxLength` 4000, `textAlignVertical: 'top'`) · nhãn "Phong cách" + "(tùy chọn)" · lưới 2×2 `OptionChip variant='solid'` (`image-style-${style}`) · nhãn "Tỷ lệ ảnh" · hàng 3 `OptionChip variant='soft'` (`image-ratio-${ratio}`) · chân: `FooterButton` `image-generate`, `disabled={!prompt.trim() \|\| submitting}` |
| `GeneratingView` | `prompt, ratio, onCancel, bottomInset` | `PromptCard` · cách 29 · `ImageFrame` rộng 345 cao `345 / frameAspect(ratio)` chứa: vòng trắng 56 + `IconSparkle` 22 navy, tiêu đề bold 15, phụ đề 12 `textBody` · chân: `FooterButton tone='soft'` `image-cancel` |
| `ResultView` | `title, generation, onOpenViewer, onRegenerate, onEdit, onSave, saving, bottomInset` | tiêu đề bold 20 · cách 11 · `Pressable` `image-open-viewer` bọc `ImageFrame` + `GeneratedImage` đúng tỷ lệ · cách 21 · hàng 2 nút cao 44 (`image-regenerate` với `IconRefresh`, `image-edit` với `IconPencil`; nền trắng viền `aiFieldBorder` bo 14; icon 16 + chữ medium 14, cách nhau 10) · cách 31 · nhãn "Mô tả đã dùng" · `PromptCard muted` · chân: `FooterButton` `image-save` |
| `ErrorView` | `prompt, onRetry, onEdit, bottomInset` | căn giữa: vòng 76 nền `aiErrorSoft` + `IconImage` 30 màu `aiDanger` · cách 27 · tiêu đề bold 21 lh 27 · mô tả regular 13 lh 23 `textBody` căn giữa · cách 47 · `PromptCard` · chân: `FooterButton tone='soft'` `image-edit` + cách 12 + `FooterButton` `image-retry` (nhãn `t.ai.retry_answer`) |

Khoảng cách trên cùng của thân cuộn: Form 31, Đang tạo 27, Kết quả 22, Lỗi căn giữa theo chiều dọc (`flexGrow: 1, justifyContent: 'center'`).

Kiểm: `npx tsc --noEmit` → 0 lỗi.

```bash
git add src/screens/ImageGenScreen
git commit -m "feat(ai-image): building blocks for the image screen"
```

---

### Việc C6: `ImageGenScreen`

**Tạo:** `src/screens/ImageGenScreen/ImageGenScreen.tsx`, `src/screens/ImageGenScreen/__tests__/ImageGenScreen.test.tsx` · **Sửa:** `App.tsx` (kiểu route)

**Bước 1 — kiểu route** trong `RootStackParamList` (`App.tsx`), sau `ChatSessionsScreen`:

```ts
  /** Màn Tạo ảnh — Figma 1166:4089 → 3837. Không có `sessionId` = phiên mới, tạo lúc bấm Tạo */
  ImageGenScreen: {sessionId?: string} | undefined;
  /** Xem lớn — 1166:3817. Vuốt qua mọi ảnh đã xong của phiên */
  ImageViewerScreen: {sessionId: string; initialMessageId?: string};
```

**Bước 2 — test đỏ:**

```tsx
// src/screens/ImageGenScreen/__tests__/ImageGenScreen.test.tsx
import React from 'react';
import {act, fireEvent, screen, waitFor} from '@testing-library/react-native';

import renderScreen from '@/testUtils/renderScreen';
import * as api from '@/services/aiChatApi';
import {saveImageToPhotos} from '@/services/savePhoto';
import ImageGenScreen from '../ImageGenScreen';

jest.mock('@/services/aiChatApi', () => ({
  ...jest.requireActual('@/services/aiChatApi'),
  getUsage: jest.fn(),
  getImageSession: jest.fn(),
  createSession: jest.fn(),
  sendMessage: jest.fn(),
  stopMessage: jest.fn(),
  retryMessage: jest.fn(),
  openConversationStream: jest.fn(() => ({close: jest.fn()})),
}));
jest.mock('@/services/savePhoto', () => ({
  ...jest.requireActual('@/services/savePhoto'),
  saveImageToPhotos: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;
const navigation = {goBack: jest.fn(), navigate: jest.fn(), push: jest.fn()};

const renderWith = (sessionId?: string) =>
  renderScreen(
    <ImageGenScreen
      navigation={navigation as never}
      route={{key: 'k', name: 'ImageGenScreen', params: sessionId ? {sessionId} : undefined} as never}
    />,
  );

const sessionWith = (over: Partial<api.ImageGeneration>): api.ImageSession => ({
  id: 'c1',
  title: 'Robot Mindo 3D',
  generations: [{messageId: 'a1', prompt: 'robot', style: 'THREE_D', aspectRatio: '9:16', status: 'done', uri: 'https://x/1.jpg', ...over}],
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getUsage.mockResolvedValue({used: 0, limit: 50, remaining: 50});
});

describe('ImageGenScreen', () => {
  it('form: nút Tạo tắt khi mô tả rỗng', async () => {
    renderWith();
    expect(screen.getByTestId('image-generate')).toBeDisabled();
  });

  it('form: gửi đúng mô tả, phong cách và tỷ lệ đã chọn', async () => {
    mocked.createSession.mockResolvedValue({id: 'c1'} as never);
    mocked.sendMessage.mockResolvedValue({userMessage: {id: 'u1'}, assistantMessage: {id: 'a1'}} as never);
    renderWith();

    fireEvent.changeText(screen.getByTestId('image-prompt-input'), 'robot trợ lý');
    fireEvent.press(screen.getByTestId('image-style-THREE_D'));
    fireEvent.press(screen.getByTestId('image-ratio-9:16'));
    await act(async () => fireEvent.press(screen.getByTestId('image-generate')));

    expect(mocked.createSession).toHaveBeenCalledWith('image');
    expect(mocked.sendMessage).toHaveBeenCalledWith('c1', 'robot trợ lý', {
      kind: 'image', imageStyle: 'THREE_D', aspectRatio: '9:16',
    });
    /* chuyển sang Đang tạo NGAY, không đợi nạp lại phiên */
    expect(await screen.findByTestId('image-cancel')).toBeTruthy();
  });

  it('kết quả: hiện tiêu đề, bấm Tải hình ảnh thì lưu đúng ảnh', async () => {
    mocked.getImageSession.mockResolvedValue(sessionWith({}));
    renderWith('c1');

    expect(await screen.findByText('Robot Mindo 3D')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('image-save')));
    expect(saveImageToPhotos).toHaveBeenCalledWith('https://x/1.jpg');
  });

  it('kết quả: Tạo lại gửi lượt mới với CÙNG cài đặt', async () => {
    mocked.getImageSession.mockResolvedValue(sessionWith({}));
    mocked.sendMessage.mockResolvedValue({userMessage: {id: 'u2'}, assistantMessage: {id: 'a2'}} as never);
    renderWith('c1');

    await act(async () => fireEvent.press(await screen.findByTestId('image-regenerate')));
    expect(mocked.sendMessage).toHaveBeenCalledWith('c1', 'robot', {kind: 'image', imageStyle: 'THREE_D', aspectRatio: '9:16'});
  });

  it('kết quả: bấm ảnh mở màn Xem lớn đúng ảnh', async () => {
    mocked.getImageSession.mockResolvedValue(sessionWith({}));
    renderWith('c1');

    fireEvent.press(await screen.findByTestId('image-open-viewer'));
    expect(navigation.push).toHaveBeenCalledWith('ImageViewerScreen', {sessionId: 'c1', initialMessageId: 'a1'});
  });

  it('lỗi: Thử lại gọi /retry cho đúng tin', async () => {
    mocked.getImageSession.mockResolvedValue(sessionWith({status: 'failed', uri: undefined}));
    mocked.retryMessage.mockResolvedValue();
    renderWith('c1');

    await act(async () => fireEvent.press(await screen.findByTestId('image-retry')));
    expect(mocked.retryMessage).toHaveBeenCalledWith('a1');
  });

  it('lỗi: Sửa mô tả về form đã điền sẵn', async () => {
    mocked.getImageSession.mockResolvedValue(sessionWith({status: 'failed', uri: undefined}));
    renderWith('c1');

    fireEvent.press(await screen.findByTestId('image-edit'));
    expect(screen.getByTestId('image-prompt-input').props.value).toBe('robot');
  });

  it('đang tạo: Hủy gọi /stop và về form, GIỮ mô tả', async () => {
    mocked.getImageSession.mockResolvedValue(sessionWith({status: 'pending', uri: undefined}));
    mocked.stopMessage.mockResolvedValue();
    renderWith('c1');

    await act(async () => fireEvent.press(await screen.findByTestId('image-cancel')));
    expect(mocked.stopMessage).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(screen.getByTestId('image-prompt-input').props.value).toBe('robot'));
  });

  it('đang tạo: mở SSE theo dõi đúng tin', async () => {
    mocked.getImageSession.mockResolvedValue(sessionWith({status: 'pending', uri: undefined}));
    renderWith('c1');

    await waitFor(() => expect(mocked.openConversationStream).toHaveBeenCalledWith('c1', 'a1', expect.any(Object)));
  });
});
```

**Bước 3:** `npx jest src/screens/ImageGenScreen` → ĐỎ.

**Bước 4 — code:**

```tsx
// src/screens/ImageGenScreen/ImageGenScreen.tsx
import React, {useCallback, useEffect, useState} from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useQuery, useQueryClient} from '@tanstack/react-query';

import {RootStackParamList} from '../../../App';
import {
  aiChatKeys,
  AiQuotaError,
  AspectRatio,
  createSession,
  getImageSession,
  getUsage,
  hasQuotaLeft,
  ImageGeneration,
  ImageSession,
  ImageStyle,
  openConversationStream,
  retryMessage,
  sendMessage,
  stopMessage,
} from '@/services/aiChatApi';
import {PhotoPermissionError, saveImageToPhotos} from '@/services/savePhoto';
import {errorMessage} from '@/network/response';
import AppNotificationOverlay from '@/components/AppNotification/AppNotificationOverlay';
import {NotificationTone} from '@/components/AppNotification/AppNotification';
import {useTheme} from '@/styles/theme/ThemeProvider';
import {useLanguage} from '@/hooks/useLanguage';

import ChatHeader from '../AiChatScreen/components/ChatHeader';
import UsageLimitDialog from '../AiChatScreen/components/UsageLimitDialog';
import ErrorView from './components/ErrorView';
import GeneratingView from './components/GeneratingView';
import PromptForm from './components/PromptForm';
import ResultView from './components/ResultView';
import {latestGeneration, phaseOf, withPendingGeneration} from './imageGenState';

type Props = NativeStackScreenProps<RootStackParamList, 'ImageGenScreen'>;

/**
 * Màn Tạo ảnh — Figma 1166:4089 (form) · 3734 (đang tạo) · 3770 (kết quả) ·
 * 3837 (lỗi). Một phiên AI loại ảnh; mỗi lần Tạo / Tạo lại là một cặp tin.
 *
 * Trạng thái hiển thị SUY RA từ tin cuối của phiên — xem `imageGenState.ts`.
 * Màn này chỉ giữ ba thứ của riêng nó: nội dung form, cờ "đang sửa", và
 * `sessionId` (vì phiên mới chỉ được tạo lúc bấm Tạo lần đầu).
 */
const ImageGenScreen: React.FC<Props> = ({navigation, route}) => {
  const insets = useSafeAreaInsets();
  const {colors} = useTheme();
  const {languageTrans: t} = useLanguage();
  const queryClient = useQueryClient();

  const [sessionId, setSessionId] = useState(route.params?.sessionId);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<ImageStyle>('AUTO');
  const [ratio, setRatio] = useState<AspectRatio>('1:1');
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showLimit, setShowLimit] = useState(false);
  const [notice, setNotice] = useState<{title: string; message: string; tone: NotificationTone}>();

  const sessionKey = aiChatKeys.imageSession(sessionId ?? '');

  const {data: usage} = useQuery({queryKey: aiChatKeys.usage, queryFn: getUsage, staleTime: 0});
  const {data: session} = useQuery({
    queryKey: sessionKey,
    queryFn: () => getImageSession(sessionId as string),
    enabled: !!sessionId,
  });

  const last = latestGeneration(session);
  const phase = phaseOf(session, editing);

  const refreshSession = useCallback(() => {
    if (sessionId) {
      queryClient.invalidateQueries({queryKey: aiChatKeys.imageSession(sessionId)});
    }
    queryClient.invalidateQueries({queryKey: aiChatKeys.sessions});
  }, [queryClient, sessionId]);

  const fillFrom = (g: ImageGeneration) => {
    setPrompt(g.prompt);
    setStyle(g.style);
    setRatio(g.aspectRatio);
  };

  /* Vừa hủy (ở máy này hay máy khác) → về form với đúng mô tả vừa dùng */
  useEffect(() => {
    if (last?.status === 'cancelled') {
      fillFrom(last);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.messageId, last?.status]);

  /* Theo dõi ảnh đang tạo. SSE báo xong hay hỏng thì cũng chỉ việc nạp lại phiên */
  const pendingId = last?.status === 'pending' ? last.messageId : undefined;
  useEffect(() => {
    if (!sessionId || !pendingId) {
      return;
    }
    const stream = openConversationStream(sessionId, pendingId, {
      onDone: refreshSession,
      onError: refreshSession,
    });
    return () => stream.close();
  }, [sessionId, pendingId, refreshSession]);

  const notifyFailed = (title: string, error: unknown) =>
    setNotice({title, message: errorMessage(error, t.ai.notice_generic_desc), tone: 'error'});

  const generate = async (input: {prompt: string; style: ImageStyle; ratio: AspectRatio}) => {
    const text = input.prompt.trim();
    if (!text || submitting) {
      return;
    }
    /* Hết lượt thì mở thẳng màn hết lượt, không gửi đi cho BE từ chối */
    if (!hasQuotaLeft(usage)) {
      setShowLimit(true);
      return;
    }
    setSubmitting(true);
    try {
      let id = sessionId;
      if (!id) {
        id = (await createSession('image')).id;
        setSessionId(id);
      }
      const result = await sendMessage(id, text, {kind: 'image', imageStyle: input.style, aspectRatio: input.ratio});
      queryClient.setQueryData<ImageSession>(aiChatKeys.imageSession(id), prev =>
        withPendingGeneration(prev, id as string, {
          messageId: result.assistantMessage.id,
          prompt: text,
          style: input.style,
          aspectRatio: input.ratio,
        }),
      );
      setEditing(false);
      queryClient.invalidateQueries({queryKey: aiChatKeys.usage});
      queryClient.invalidateQueries({queryKey: aiChatKeys.sessions});
    } catch (error) {
      if (error instanceof AiQuotaError) {
        queryClient.invalidateQueries({queryKey: aiChatKeys.usage});
        setShowLimit(true);
      } else {
        notifyFailed(t.ai.image_send_failed_title, error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!last) {
      return;
    }
    /* Đổi màn NGAY — người vừa bấm Hủy không nên phải nhìn vòng chờ thêm một nhịp */
    fillFrom(last);
    setEditing(true);
    await stopMessage(last.messageId).catch(() => undefined);
    refreshSession();
  };

  const retry = async () => {
    if (!last) {
      return;
    }
    try {
      await retryMessage(last.messageId);
      refreshSession();
    } catch (error) {
      if (error instanceof AiQuotaError) {
        setShowLimit(true);
      } else {
        notifyFailed(t.ai.image_send_failed_title, error);
      }
    }
  };

  const edit = () => {
    if (last) {
      fillFrom(last);
    }
    setEditing(true);
  };

  const save = async (uri: string) => {
    setSaving(true);
    try {
      await saveImageToPhotos(uri);
      setNotice({title: t.ai.image_saved_title, message: t.ai.image_saved_desc, tone: 'success'});
    } catch (error) {
      setNotice({
        title: t.ai.image_save_failed_title,
        message: error instanceof PhotoPermissionError
          ? t.ai.image_permission_desc
          : errorMessage(error, t.ai.notice_generic_desc),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const bottomInset = Math.max(insets.bottom, 12);

  return (
    <View style={[styles.root, {backgroundColor: colors.bg.surface}]}>
      <StatusBar barStyle={'dark-content'} backgroundColor={colors.util.transparent} translucent />

      <View style={{paddingTop: insets.top + 8}}>
        <ChatHeader
          title={t.ai.image_title}
          onBack={navigation.goBack}
          onOpenHistory={() => navigation.navigate('ChatSessionsScreen')}
        />
      </View>

      <KeyboardAvoidingView behavior={'padding'} style={styles.root}>
        {phase === 'form' && (
          <PromptForm
            prompt={prompt}
            onChangePrompt={setPrompt}
            style={style}
            onChangeStyle={setStyle}
            ratio={ratio}
            onChangeRatio={setRatio}
            submitting={submitting}
            onSubmit={() => generate({prompt, style, ratio})}
            bottomInset={bottomInset}
          />
        )}
        {phase === 'generating' && last && (
          <GeneratingView prompt={last.prompt} ratio={last.aspectRatio} onCancel={cancel} bottomInset={bottomInset} />
        )}
        {phase === 'result' && last && (
          <ResultView
            title={session?.title ?? ''}
            generation={last}
            saving={saving}
            onOpenViewer={() =>
              navigation.push('ImageViewerScreen', {sessionId: sessionId as string, initialMessageId: last.messageId})
            }
            onRegenerate={() => generate({prompt: last.prompt, style: last.style, ratio: last.aspectRatio})}
            onEdit={edit}
            onSave={() => last.uri && save(last.uri)}
            bottomInset={bottomInset}
          />
        )}
        {phase === 'error' && last && (
          <ErrorView prompt={last.prompt} onRetry={retry} onEdit={edit} bottomInset={bottomInset} />
        )}
      </KeyboardAvoidingView>

      <AppNotificationOverlay
        title={notice?.title ?? ''}
        message={notice?.message}
        tone={notice?.tone}
        onDismiss={() => setNotice(undefined)}
      />
      <UsageLimitDialog
        visible={showLimit}
        onClose={() => setShowLimit(false)}
        onBuy={() => {
          setShowLimit(false);
          navigation.navigate('ComingSoonScreen', {title: t.ai.buy_nft});
        }}
      />
    </View>
  );
};

export default ImageGenScreen;

const styles = StyleSheet.create({
  root: {flex: 1},
});
```

**Bước 5:** chạy → XANH (9 test).

**Bước 6:**
```bash
git add App.tsx src/screens/ImageGenScreen
git commit -m "feat(ai-image): image screen with form, generating, result and error states"
```

---

### Việc C7: `ImageViewerScreen`

**Tạo:** `src/screens/ImageGenScreen/ImageViewerScreen.tsx`, `src/screens/ImageGenScreen/__tests__/ImageViewerScreen.test.tsx`

**Bước 1 — test đỏ:**

```tsx
import React from 'react';
import {act, fireEvent, screen} from '@testing-library/react-native';

import renderScreen from '@/testUtils/renderScreen';
import * as api from '@/services/aiChatApi';
import {saveImageToPhotos} from '@/services/savePhoto';
import ImageViewerScreen from '../ImageViewerScreen';

jest.mock('@/services/aiChatApi', () => ({...jest.requireActual('@/services/aiChatApi'), getImageSession: jest.fn()}));
jest.mock('@/services/savePhoto', () => ({...jest.requireActual('@/services/savePhoto'), saveImageToPhotos: jest.fn()}));

const mocked = api as jest.Mocked<typeof api>;
const navigation = {goBack: jest.fn()};
const g = (id: string, over: Partial<api.ImageGeneration> = {}): api.ImageGeneration => ({
  messageId: id, prompt: 'p', style: 'AUTO', aspectRatio: '1:1', status: 'done', uri: `https://x/${id}.jpg`, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getImageSession.mockResolvedValue({
    id: 'c1',
    title: 'Robot Mindo 3D',
    generations: [g('a1'), g('a2', {status: 'failed', uri: undefined}), g('a3'), g('a4')],
  });
});

const renderAt = (initialMessageId?: string) =>
  renderScreen(
    <ImageViewerScreen
      navigation={navigation as never}
      route={{key: 'k', name: 'ImageViewerScreen', params: {sessionId: 'c1', initialMessageId}} as never}
    />,
  );

it('bộ đếm chỉ tính ảnh đã xong, mở đúng ảnh được bấm', async () => {
  renderAt('a3');
  /* a2 hỏng nên không nằm trong dãy: a1, a3, a4 → a3 là 2 / 3 */
  expect(await screen.findByText('2 / 3')).toBeTruthy();
  expect(screen.getByText('Robot Mindo 3D')).toBeTruthy();
});

it('tải lưu đúng ảnh đang xem', async () => {
  renderAt('a4');
  await screen.findByText('3 / 3');
  await act(async () => fireEvent.press(screen.getByTestId('viewer-save')));
  expect(saveImageToPhotos).toHaveBeenCalledWith('https://x/a4.jpg');
});

it('đóng quay về', async () => {
  renderAt();
  fireEvent.press(await screen.findByTestId('viewer-close'));
  expect(navigation.goBack).toHaveBeenCalled();
});
```

**Bước 2:** chạy → ĐỎ.

**Bước 3 — code:**

```tsx
// src/screens/ImageGenScreen/ImageViewerScreen.tsx
import React, {useMemo, useState} from 'react';
import {FlatList, Pressable, StatusBar, StyleSheet, useWindowDimensions, View} from 'react-native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useQuery} from '@tanstack/react-query';

import {RootStackParamList} from '../../../App';
import AppText from '@/components/AppText/AppText';
import AppNotificationOverlay from '@/components/AppNotification/AppNotificationOverlay';
import {NotificationTone} from '@/components/AppNotification/AppNotification';
import IconClose from '@/components/icons/IconClose';
import IconDownload from '@/components/icons/IconDownload';
import {aiChatKeys, getImageSession} from '@/services/aiChatApi';
import {PhotoPermissionError, saveImageToPhotos} from '@/services/savePhoto';
import {errorMessage} from '@/network/response';
import {screenColor} from '@/styles/screenTokens';
import {useTheme} from '@/styles/theme/ThemeProvider';
import {useLanguage} from '@/hooks/useLanguage';

import GeneratedImage from './components/GeneratedImage';
import ImageFrame from './components/ImageFrame';
import {imageGenMetrics as m} from './imageGenMetrics';
import {doneGenerations, frameAspect} from './imageGenState';

type Props = NativeStackScreenProps<RootStackParamList, 'ImageViewerScreen'>;

/**
 * Xem lớn — Figma 1166:3817. Vuốt ngang qua mọi ảnh ĐÃ XONG của phiên; bộ
 * đếm "i / n" chỉ tính những ảnh đó, ảnh hỏng không chiếm chỗ.
 *
 * Đọc cùng khoá cache với `ImageGenScreen`, nên mở từ đó thì hiện tức thì.
 */
const ImageViewerScreen: React.FC<Props> = ({navigation, route}) => {
  const {sessionId, initialMessageId} = route.params;
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const {colors} = useTheme();
  const {languageTrans: t} = useLanguage();

  const {data: session} = useQuery({
    queryKey: aiChatKeys.imageSession(sessionId),
    queryFn: () => getImageSession(sessionId),
  });
  const images = useMemo(() => doneGenerations(session), [session]);
  const startIndex = Math.max(0, images.findIndex(g => g.messageId === initialMessageId));
  const [index, setIndex] = useState<number>();
  const current = index ?? startIndex;

  const [notice, setNotice] = useState<{title: string; message: string; tone: NotificationTone}>();

  const save = async () => {
    const uri = images[current]?.uri;
    if (!uri) {
      return;
    }
    try {
      await saveImageToPhotos(uri);
      setNotice({title: t.ai.image_saved_title, message: t.ai.image_saved_desc, tone: 'success'});
    } catch (error) {
      setNotice({
        title: t.ai.image_save_failed_title,
        message: error instanceof PhotoPermissionError ? t.ai.image_permission_desc : errorMessage(error, t.ai.notice_generic_desc),
        tone: 'error',
      });
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: screenColor.aiViewerBg}]}>
      <StatusBar barStyle={'light-content'} />

      <View style={[styles.topBar, {paddingTop: insets.top + 8}]}>
        <Pressable
          testID={'viewer-close'}
          onPress={navigation.goBack}
          accessibilityRole={'button'}
          accessibilityLabel={t.ai.image_close}
          style={[styles.button, styles.round, {backgroundColor: screenColor.aiViewerButton}]}>
          <IconClose size={14} color={colors.util.white} />
        </Pressable>
        <Pressable
          testID={'viewer-save'}
          onPress={save}
          accessibilityRole={'button'}
          accessibilityLabel={t.ai.image_save}
          style={[styles.button, {backgroundColor: screenColor.aiViewerButton}]}>
          <IconDownload size={16} color={colors.util.white} />
        </Pressable>
      </View>

      {images.length > 0 && (
        <FlatList
          /* key theo số ảnh: dữ liệu nạp xong sau lần render đầu thì dựng lại
             để `initialScrollIndex` có hiệu lực */
          key={images.length}
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({length: width, offset: width * i, index: i})}
          keyExtractor={g => g.messageId}
          onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({item}) => {
            const h = width / frameAspect(item.aspectRatio);
            return (
              <View style={[styles.page, {width}]}>
                <ImageFrame width={width} height={h}>
                  {!!item.uri && <GeneratedImage uri={item.uri} width={width} height={h} />}
                </ImageFrame>
              </View>
            );
          }}
        />
      )}

      <View style={[styles.caption, {paddingBottom: insets.bottom + 48}]}>
        <AppText numberOfLines={1} style={[styles.title, {color: colors.util.white}]}>{session?.title ?? ''}</AppText>
        {images.length > 0 && (
          <AppText style={[styles.counter, {color: screenColor.aiViewerCounter}]}>
            {`${current + 1} / ${images.length}`}
          </AppText>
        )}
      </View>

      <AppNotificationOverlay
        title={notice?.title ?? ''}
        message={notice?.message}
        tone={notice?.tone}
        onDismiss={() => setNotice(undefined)}
      />
    </View>
  );
};

export default ImageViewerScreen;

const styles = StyleSheet.create({
  root: {flex: 1},
  topBar: {flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: m.side - 1},
  button: {
    width: m.viewerButton,
    height: m.viewerButton,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: {borderRadius: m.viewerButton / 2},
  list: {flexGrow: 0, marginTop: 'auto'},
  listContent: {alignItems: 'center'},
  page: {alignItems: 'center', justifyContent: 'center'},
  caption: {marginTop: 'auto', alignItems: 'center', paddingHorizontal: m.side, paddingTop: 36},
  title: {fontSize: 17, lineHeight: 22, fontWeight: '700'},
  counter: {fontSize: 12, lineHeight: 16, marginTop: 13},
});
```

**Bước 4:** chạy → XANH.

**Bước 5:**
```bash
git add src/screens/ImageGenScreen
git commit -m "feat(ai-image): full-screen viewer that swipes through the session's images"
```

---

### Việc C8: Đăng ký route + đổi các lối vào

**Tạo:** `src/screens/AiChatScreen/sessionRoute.ts`, `src/screens/AiChatScreen/__tests__/sessionRoute.test.ts` · **Sửa:** `App.tsx`, `src/screens/AiChatScreen/AiChatScreen.tsx`, `src/screens/AiChatScreen/ChatSessionsScreen.tsx`

**Bước 1 — test đỏ:**

```ts
import {sessionRoute} from '../sessionRoute';

describe('sessionRoute', () => {
  it('phiên ảnh mở màn Tạo ảnh', () => {
    expect(sessionRoute({id: 'c1', title: 'Robot', kind: 'image'} as never)).toEqual(['ImageGenScreen', {sessionId: 'c1'}]);
  });

  it('phiên khác mở màn chat như cũ', () => {
    expect(sessionRoute({id: 'c2', title: 'Hỏi', kind: 'chat'} as never)).toEqual([
      'AiChatScreen',
      {sessionId: 'c2', title: 'Hỏi', heroVariant: 'session', kind: 'chat'},
    ]);
  });
});
```

**Bước 2:** chạy → ĐỎ.

**Bước 3 — code:**

```ts
// src/screens/AiChatScreen/sessionRoute.ts
import {ChatSession} from '@/services/aiChatApi';

/**
 * Bấm một phiên trong Lịch sử thì mở màn nào.
 *
 * Tách ra hàm vì quyết định này nằm giữa hai màn và dễ bị quên: phiên ảnh
 * mà mở bằng màn chat thì hiện bong bóng cũ, không có nút Tạo lại/Tải ảnh.
 */
export function sessionRoute(
  session: ChatSession,
):
  | ['ImageGenScreen', {sessionId: string}]
  | ['AiChatScreen', {sessionId: string; title: string; heroVariant: 'session'; kind: ChatSession['kind']}] {
  return session.kind === 'image'
    ? ['ImageGenScreen', {sessionId: session.id}]
    : ['AiChatScreen', {sessionId: session.id, title: session.title, heroVariant: 'session', kind: session.kind}];
}
```

`ChatSessionsScreen.tsx` — thay `onPress` của `SessionRow` (giữ nguyên khối chú thích về `push`):

```tsx
                    onPress={() => navigation.push(...sessionRoute(session))}
```

`AiChatScreen.tsx` — trong `handleSelectKind`, sau khối `translate`:

```tsx
    /* Tạo ảnh có màn riêng (Figma 1166:4089); phiên chỉ được tạo lúc bấm Tạo */
    if (selected === 'image') {
      navigation.push('ImageGenScreen');
      return;
    }
```

`App.tsx` — import hai màn và đăng ký sau `ChatSessionsScreen`:

```tsx
            <Stack.Screen name={'ImageGenScreen'} component={ImageGenScreen} />
            <Stack.Screen
              name={'ImageViewerScreen'}
              component={ImageViewerScreen}
              options={{presentation: 'fullScreenModal', animation: 'fade'}}
            />
```

**Bước 4:** chạy test → XANH; `npx tsc --noEmit` → 0 lỗi.

**Bước 5:**
```bash
git add App.tsx src/screens/AiChatScreen
git commit -m "feat(ai-image): route image sessions and the Create image entry to the new screen"
```

---

### Việc C9: Kiểm tra toàn bộ + chạy thật

```bash
cd /Users/Work_home/Project_Hungs/Mindo/Mindo-App
npx tsc --noEmit                                   # 0 lỗi
npx jest                                           # tất cả xanh (1084 + ~34 mới)
npx eslint src/screens/ImageGenScreen src/services/savePhoto.ts src/services/aiChatApi.ts \
  src/screens/AiChatScreen/sessionRoute.ts         # sạch
```

**Build lại native** (vì có thư viện mới) cho simulator iPhone Air `B24C15D6-9502-4888-9AA6-29FB30F2BE41`, API cục bộ:
- `.env` + `ios/tmp.xcconfig` đặt `API_ENDPOINT` = `http://localhost:4000/api/v1/` (xcconfig phải thoát `//` thành `/$()/`), chạy `BuildDotenvConfig.rb`, build, cài, rồi **khôi phục cả hai file**.
- API cục bộ phải chạy với `APP_URL=http://localhost:4000` (nếu không, link ảnh trỏ về staging → 401) và `IMAGE_VENDOR=pollinations`.

Chạy trọn trên máy, chụp màn từng trạng thái:
1. Mindo AI → "Tạo hình ảnh" → **Form** (đối chiếu 1166:4089)
2. Gõ mô tả, chọn 3D + 9:16 → Tạo → **Đang tạo** (3734)
3. Chờ → **Kết quả**: tiêu đề ngắn do AI đặt, ảnh DỌC (3770)
4. Bấm ảnh → **Xem lớn** "1 / 1" (3817) → Tải → xin quyền → "Đã lưu ảnh"; kiểm trong app Ảnh của simulator
5. Tạo lại → Xem lớn thấy "2 / 2"
6. Tạo mới rồi Hủy ngay → về Form, mô tả còn nguyên; CSDL tin đó `CANCELLED`
7. Dựng lỗi (đặt tin cuối `FAILED` trong CSDL) → **Lỗi** (3837) → Thử lại → chạy lại đúng tin, số tin trong phiên không tăng
8. Lịch sử → bấm phiên ảnh → mở lại đúng màn Tạo ảnh ở trạng thái Kết quả

### Việc C10: Đẩy lên

**Chỉ làm khi người dùng đồng ý.** Hai repo, ba nhánh:
- Mindo-API `feat/image-generation`
- Mindo-App `feat/ai-chat-stop-retry` (PR riêng, merge trước)
- Mindo-App `feat/image-gen-screen` (xếp chồng lên nhánh trên)

PR mô tả bằng tiếng Việt, không có dòng ghi công.
