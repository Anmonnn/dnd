/**
 * Zod-схемы файлов, которые пишет человек (или редактор): фронтматтер лора, map.json,
 * features.geojson, land.geojson, world.json, а также метаданные тайлов и тела запросов dev-API.
 *
 * Необязательные поля принимают null: Obsidian записывает пустое свойство как `key:`.
 */
import { z } from 'zod';
import { KIND_IDS } from './kinds.ts';
import { SLUG_RE } from './paths.ts';

export const KindSchema = z.enum(KIND_IDS);
export const VisibilitySchema = z.enum(['public', 'dm']);
export const DetailSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const ColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'цвет в формате #rgb или #rrggbb');
export const SlugSchema = z.string().regex(SLUG_RE, 'только a-z, 0-9 и дефисы');

/** `tags: a` и `tags: [a, b]` — оба варианта допустимы. */
const StringList = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : [v]));

const FactValue = z.union([z.string(), z.number(), z.boolean(), z.date()]);

// ─── world/world.json ────────────────────────────────────────────────────────

export const WorldConfigSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullish(),
  defaultMap: SlugSchema,
});
export type WorldConfig = z.infer<typeof WorldConfigSchema>;

// ─── world/lore/**/*.md (фронтматтер) ───────────────────────────────────────

export const LoreFrontmatterSchema = z.looseObject({
  /** По умолчанию — slugify(имя файла). */
  id: SlugSchema.nullish(),
  /** По умолчанию — имя файла. */
  name: z.string().min(1).nullish(),
  /** По умолчанию — note. */
  kind: KindSchema.nullish(),
  summary: z.string().nullish(),
  /** id, имя, алиас или "[[вики-ссылка]]" родителя. */
  parent: z.string().nullish(),
  /** id подробной карты (папка world/maps/<id>). */
  map: SlugSchema.nullish(),
  color: ColorSchema.nullish(),
  icon: z.string().max(8).nullish(),
  image: z.string().nullish(),
  aliases: StringList.nullish(),
  tags: StringList.nullish(),
  visibility: VisibilitySchema.nullish(),
  facts: z.record(z.string(), FactValue.nullable()).nullish(),
  /** Портрет/аватар: файл рядом со статьёй или в world/ (можно "[[файл.png]]"), либо http-URL. */
  avatar: z.string().nullish(),
  /** Где сущность на карте (кружок с аватаром): id, имя, алиас или "[[ссылка]]" места. */
  location: z.string().nullish(),
});
export type LoreFrontmatter = z.infer<typeof LoreFrontmatterSchema>;

// ─── world/maps/<id>/map.json ────────────────────────────────────────────────

export const MapConfigSchema = z.object({
  title: z.string().min(1),
  /** Файл арта в папке карты: png/jpg/webp/svg. */
  source: z.string().nullish(),
  /** Пространство координат [ширина, высота]. Заполняется `npm run maps` по размеру арта, дальше не меняется. */
  size: z.tuple([z.number().positive(), z.number().positive()]).nullish(),
  background: z.string().nullish(),
  /** Сущность, которую изображает карта. */
  entity: z.string().nullish(),
  /** Родительская карта. */
  parent: SlugSchema.nullish(),
  /** Обрезать области (государства, регионы) по land.geojson. По умолчанию true. */
  clipAreasToLand: z.boolean().nullish(),
  visibility: VisibilitySchema.nullish(),
});
export type MapConfig = z.infer<typeof MapConfigSchema>;

// ─── GeoJSON (только 2D, только нужные типы геометрии) ──────────────────────

const Position = z.array(z.number()).min(2).max(3);
const Ring = z.array(Position).min(4);

export const PolygonSchema = z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring).min(1) });
export const MultiPolygonSchema = z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(Ring).min(1)).min(1) });

export const GeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: Position }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(Position).min(2) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(Position).min(2)).min(1) }),
  PolygonSchema,
  MultiPolygonSchema,
]);

export const FeaturePropsSchema = z.looseObject({
  entity: z.string().nullish(),
  kind: KindSchema.nullish(),
  name: z.string().nullish(),
  detail: DetailSchema.nullish(),
  color: ColorSchema.nullish(),
  visibility: VisibilitySchema.nullish(),
  /** Своя точка подписи области [x, y] вместо автоматической. */
  labelAt: z.tuple([z.number(), z.number()]).nullish(),
});

export const FeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).nullish(),
  properties: FeaturePropsSchema.nullish(),
  geometry: GeometrySchema,
});

export const FeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(FeatureSchema),
});
export type AuthoredFeatureCollection = z.infer<typeof FeatureCollectionSchema>;

/** world/maps/<id>/land.geojson — суша (генерирует `npm run maps:land`, можно править руками). */
/** Растушёвка краёв врезки по умолчанию — доля меньшей стороны. */
export const INSET_DEFAULT_FEATHER = 0.08;

/** world/maps/<id>/insets/<insetId>/inset.json — детальная врезка (создаёт `npm run maps:inset`). */
export const InsetConfigSchema = z.object({
  title: z.string().nullish(),
  /** Где врезка лежит на карте: [x, y, ширина, высота] в единицах карты. */
  bounds: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
  /** Детальный арт в папке врезки; по умолчанию source.png / .jpg / .jpeg / .webp. */
  source: z.string().nullish(),
  /** С какого зума врезка видна полностью; по умолчанию — там, где арт карты начинает мылиться. */
  showFrom: z.number().nullish(),
  /** Растушёвка краёв — доля меньшей стороны врезки (0…0.45), по умолчанию 0.08. */
  feather: z.number().min(0).max(0.45).nullish(),
});
export type InsetConfig = z.infer<typeof InsetConfigSchema>;

/** public/generated/insets/<mapId>/<insetId>/meta.json (пишет `npm run maps`). */
export const InsetMetaSchema = z.object({
  version: z.literal(1),
  sourceFile: z.string(),
  /** Хеш арта и всех параметров нарезки (bounds, feather, уровни). */
  sourceHash: z.string(),
  sourceSize: z.tuple([z.number(), z.number()]),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  feather: z.number(),
  minZoom: z.number().int(),
  maxNativeZoom: z.number().int(),
  tileSize: z.number().int(),
  /** Относительно public/: "generated/insets/world/<id>/{z}/{x}/{y}.webp". */
  tiles: z.string(),
});
export type InsetMeta = z.infer<typeof InsetMetaSchema>;

export const LandSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      properties: z.unknown().nullish(),
      geometry: z.discriminatedUnion('type', [PolygonSchema, MultiPolygonSchema]),
    }),
  ),
});

// ─── public/generated/maps/<id>/meta.json (пишет `npm run maps`) ────────────

export const TilesMetaSchema = z.object({
  version: z.literal(1),
  /** Имя исходного файла в папке карты. */
  sourceFile: z.string(),
  /** Хеш исходника + параметров нарезки: совпал — перегенерация не нужна. */
  sourceHash: z.string(),
  /** Размер исходника в пикселях. */
  sourceSize: z.tuple([z.number(), z.number()]),
  /** Пространство координат, под которое нарезано. */
  size: z.tuple([z.number(), z.number()]),
  zoomBase: z.number().int(),
  maxNativeZoom: z.number().int(),
  tileSize: z.number().int(),
  format: z.literal('webp'),
  /** Относительно public/: "generated/maps/world/preview.webp". */
  preview: z.string(),
  /** Относительно public/: "generated/maps/world/{z}/{x}/{y}.webp". */
  tiles: z.string(),
});
export type TilesMeta = z.infer<typeof TilesMetaSchema>;

// ─── dev-API (только dev-сервер, см. src/shared/api.ts) ─────────────────────

export const CreateEntityRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: KindSchema,
  /** По умолчанию slugify(name), при коллизии — с суффиксом. */
  id: SlugSchema.nullish(),
  parent: z.string().nullish(),
  summary: z.string().max(1000).nullish(),
  visibility: VisibilitySchema.nullish(),
  /** Место на карте (id сущности) — для персонажей. */
  location: z.string().nullish(),
});
export type CreateEntityRequest = z.infer<typeof CreateEntityRequestSchema>;

/** Точечная правка фронтматтера существующей статьи; null — удалить поле. */
export const UpdateEntityRequestSchema = z
  .object({
    location: z.string().trim().min(1).nullable().optional(),
    avatar: z.string().trim().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'нечего менять' });
export type UpdateEntityRequest = z.infer<typeof UpdateEntityRequestSchema>;
