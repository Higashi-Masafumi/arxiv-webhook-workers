import type { Bindings } from "../types/bindings";
import { TranslationError } from "../utils/errors";

/**
 * 翻訳サービス（Cloudflare Workers AI を使用）
 */
export class TranslationService {
  private readonly AI_MODEL = "@cf/meta/m2m100-1.2b";
  private readonly MAX_TEXT_LENGTH = 5000; // モデルの制限に合わせて調整

  constructor(private env: Bindings) {}

  /**
   * 英語のテキストを日本語に翻訳
   * @param text 翻訳するテキスト（英語）
   * @returns 翻訳されたテキスト（日本語）
   */
  async translateToJapanese(text: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      return text;
    }

    // テキストが長すぎる場合は分割して翻訳
    if (text.length > this.MAX_TEXT_LENGTH) {
      return await this.translateLongText(text);
    }

    try {
      const response = await this.env.AI.run(this.AI_MODEL, {
        text: text,
        source_lang: "english",
        target_lang: "japanese",
      });

      // レスポンスの型を確認
      if (
        response &&
        typeof response === "object" &&
        "translated_text" in response
      ) {
        return response.translated_text as string;
      }

      // フォールバック: レスポンスが文字列の場合
      if (typeof response === "string") {
        return response;
      }

      throw new TranslationError(
        "Unexpected response format from translation API"
      );
    } catch (error) {
      if (error instanceof TranslationError) {
        throw error;
      }
      throw new TranslationError(
        `Failed to translate text: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 長いテキストを分割して翻訳
   */
  private async translateLongText(text: string): Promise<string> {
    const chunks: string[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    let currentChunk = "";
    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > this.MAX_TEXT_LENGTH) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          // 1文が長すぎる場合は強制的に分割
          const midPoint = Math.floor(sentence.length / 2);
          chunks.push(sentence.slice(0, midPoint));
          currentChunk = sentence.slice(midPoint);
        }
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    // 各チャンクを翻訳
    const translatedChunks = await Promise.all(
      chunks.map((chunk) => this.translateToJapanese(chunk))
    );

    return translatedChunks.join(" ");
  }
}
