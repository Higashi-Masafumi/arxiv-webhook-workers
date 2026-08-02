import type { Paper } from "../types/paper";
import { normalizeDoi } from "../utils/paperUrl";
import { DoiMetadataClient } from "./doiMetadataClient";

/**
 * DataCite REST API クライアント
 *
 * arXiv・Zenodo・figshare など DataCite に登録された DOI の取得元。
 * arXiv 論文の DOI (`10.48550/arXiv.xxxx`) はここが登録元なので、
 * **arXiv についてはこれが唯一確実な経路**になる。
 *
 * OpenAlex にも arXiv 論文は入っているが DataCite DOI での収録は歯抜けで、
 * Crossref は登録機関が違うため一切持っていない。
 *
 * @see https://support.datacite.org/docs/api
 */
export class DataCiteClient extends DoiMetadataClient<DataCiteResponse> {
  readonly name = "DataCite";

  protected endpoint(doi: string): string {
    return `https://api.datacite.org/dois/${encodeURIComponent(doi)}`;
  }

  protected toPaper(response: DataCiteResponse, requestedDoi: string): Paper | null {
    const work = response.data?.attributes;
    if (!work) return null;

    const title = work.titles?.map((t) => this.toPlainText(t.title ?? "")).find((t) => t.length > 0);
    if (!title) return null;

    const doi = normalizeDoi(work.doi) ?? requestedDoi;

    return {
      title,
      authors: (work.creators ?? []).map((creator) => this.creatorName(creator)).filter(Boolean),
      summary: this.abstractOf(work),
      link: work.url ?? `https://doi.org/${doi}`,
      publishedYear: work.publicationYear ?? null,
      doi,
      provider: "datacite",
    };
  }

  /**
   * 個人名は givenName / familyName から組み立てる
   * （`name` は "Vaswani, Ashish" の順で入っているため）
   */
  private creatorName(creator: DataCiteCreator): string {
    const fromParts = [creator.givenName, creator.familyName].filter(Boolean).join(" ");
    return this.normalizeText(fromParts || creator.name || "");
  }

  private abstractOf(work: DataCiteAttributes): string {
    const abstract = work.descriptions?.find((d) => d.descriptionType === "Abstract");
    return abstract?.description ? this.toPlainText(abstract.description) : "";
  }
}

interface DataCiteResponse {
  data?: { attributes?: DataCiteAttributes };
}

interface DataCiteAttributes {
  doi?: string;
  url?: string;
  titles?: Array<{ title?: string }>;
  publicationYear?: number | null;
  creators?: DataCiteCreator[];
  descriptions?: Array<{ description?: string; descriptionType?: string }>;
}

interface DataCiteCreator {
  name?: string;
  givenName?: string;
  familyName?: string;
}
