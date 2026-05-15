import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";

const worker = new Worker();
export default worker;

const LETTERBOXD_BASE_URL = "https://letterboxd.com";

type DiaryEntry = {
  entryId: string;
  title: string;
  entryUrl?: string;
  filmUrl?: string;
  watchedDate: string;
  rating?: number;
  rewatch?: boolean;
};

type DiaryProperties = {
  Title: ReturnType<typeof Builder.title>;
  "Diary Entry ID": ReturnType<typeof Builder.richText>;
  "Watch Date": ReturnType<typeof Builder.date>;
  "Diary Entry"?: ReturnType<typeof Builder.url>;
  Film?: ReturnType<typeof Builder.url>;
  Rating?: ReturnType<typeof Builder.number>;
  Rewatch?: ReturnType<typeof Builder.checkbox>;
};

const username = process.env.LETTERBOXD_USERNAME?.trim();

if (!username) {
  throw new Error("Missing LETTERBOXD_USERNAME environment variable.");
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const decodeXml = (value: string) => {
  const raw = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  return raw.replace(/&(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        if (entity.startsWith("#x")) {
          const codePoint = Number.parseInt(entity.slice(2), 16);
          return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
        }
        if (entity.startsWith("#")) {
          const codePoint = Number.parseInt(entity.slice(1), 10);
          return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
        }
        return match;
      }
    }
  });
};

const extractTagValue = (xml: string, tag: string) => {
  const escapedTag = escapeRegExp(tag);
  const pattern = new RegExp(`<${escapedTag}(?:\\s+[^>]*)?>([\\s\\S]*?)</${escapedTag}>`, "i");
  const match = xml.match(pattern);
  if (!match) {
    return undefined;
  }
  const value = decodeXml(match[1]);
  return value.length > 0 ? value : undefined;
};

const parseRating = (ratingText?: string) => {
  if (!ratingText) {
    return undefined;
  }
  const rating = Number.parseFloat(ratingText);
  return Number.isFinite(rating) ? rating : undefined;
};

const parseRewatch = (rewatchText?: string) => {
  if (!rewatchText) {
    return undefined;
  }
  const normalized = rewatchText.trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) {
    return true;
  }
  if (["no", "false", "0"].includes(normalized)) {
    return false;
  }
  return undefined;
};

const resolveDiaryEntryUrl = (
  entryUrl: string | undefined,
  filmSlug: string | undefined,
  usernameValue: string,
) => {
  if (entryUrl) {
    return entryUrl;
  }
  if (filmSlug) {
    return `${LETTERBOXD_BASE_URL}/${usernameValue}/film/${filmSlug}/`;
  }
  return undefined;
};

const resolveFilmUrl = (
  entryUrl: string | undefined,
  filmSlug: string | undefined,
  usernameValue: string,
) => {
  if (filmSlug) {
    return `${LETTERBOXD_BASE_URL}/film/${filmSlug}/`;
  }
  if (!entryUrl) {
    return undefined;
  }
  if (entryUrl.startsWith(`${LETTERBOXD_BASE_URL}/film/`)) {
    return entryUrl;
  }
  const userFilmPrefix = `${LETTERBOXD_BASE_URL}/${usernameValue}/film/`;
  if (entryUrl.startsWith(userFilmPrefix)) {
    return entryUrl.replace(
      new RegExp(`^${escapeRegExp(userFilmPrefix)}`),
      `${LETTERBOXD_BASE_URL}/film/`,
    );
  }
  return undefined;
};

const parseDiaryEntries = (xml: string, usernameValue: string) => {
  const entries: DiaryEntry[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;

  for (const match of xml.matchAll(itemRegex)) {
    const itemXml = match[1];
    const watchedDate = extractTagValue(itemXml, "letterboxd:watchedDate");
    if (!watchedDate) {
      continue;
    }

    const entryId = extractTagValue(itemXml, "guid");
    if (!entryId) {
      continue;
    }

    const entryUrl = extractTagValue(itemXml, "link");
    const filmSlug = extractTagValue(itemXml, "letterboxd:filmSlug");
    const title =
      extractTagValue(itemXml, "letterboxd:filmTitle") ??
      extractTagValue(itemXml, "title") ??
      "Untitled";

    entries.push({
      entryId,
      title,
      entryUrl: resolveDiaryEntryUrl(entryUrl, filmSlug, usernameValue),
      filmUrl: resolveFilmUrl(entryUrl, filmSlug, usernameValue),
      watchedDate,
      rating: parseRating(extractTagValue(itemXml, "letterboxd:memberRating")),
      rewatch: parseRewatch(extractTagValue(itemXml, "letterboxd:rewatch")),
    });
  }

  return entries;
};

const fetchDiaryFeed = async (usernameValue: string) => {
  const response = await fetch(`${LETTERBOXD_BASE_URL}/${usernameValue}/rss/`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Letterboxd RSS feed: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
};

const diary = worker.database("letterboxdDiary", {
  type: "managed",
  initialTitle: "Letterboxd Diary",
  primaryKeyProperty: "Diary Entry ID",
  schema: {
    properties: {
      Title: Schema.title(),
      "Diary Entry ID": Schema.richText(),
      "Diary Entry": Schema.url(),
      Film: Schema.url(),
      "Watch Date": Schema.date(),
      Rating: Schema.number(),
      Rewatch: Schema.checkbox(),
    },
  },
});

worker.sync("letterboxdDiarySync", {
  database: diary,
  mode: "incremental",
  schedule: "1d",
  execute: async () => {
    const xml = await fetchDiaryFeed(username);
    const entries = parseDiaryEntries(xml, username);

    return {
      changes: entries.map((entry) => {
        const properties: DiaryProperties = {
          Title: Builder.title(entry.title),
          "Diary Entry ID": Builder.richText(entry.entryId),
          "Watch Date": Builder.date(entry.watchedDate),
        };

        if (entry.entryUrl) {
          properties["Diary Entry"] = Builder.url(entry.entryUrl);
        }
        if (entry.filmUrl) {
          properties.Film = Builder.url(entry.filmUrl);
        }
        if (entry.rating !== undefined) {
          properties.Rating = Builder.number(entry.rating);
        }
        if (entry.rewatch !== undefined) {
          properties.Rewatch = Builder.checkbox(entry.rewatch);
        }

        return {
          type: "upsert" as const,
          key: entry.entryId,
          properties,
        };
      }),
      hasMore: false,
    };
  },
});
