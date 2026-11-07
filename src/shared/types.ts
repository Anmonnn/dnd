/**
 * Скомпилированные данные мира — то, что сборщик (tooling/world) отдаёт браузеру
 * через виртуальный модуль `virtual:world`. Всё JSON-сериализуемо.
 */
import type { Geometry } from 'geojson';
import type { DetailLevel, Kind } from './kinds.ts';

export type Visibility = 'public' | 'dm';

/**
 * dm — полная версия для мастера (dev-сервер по умолчанию, `npm run build:dm`);
 * public — версия для игроков: всё с visibility: dm и блоки `> [!dm]` вырезаются ещё при сборке.
 */
export type WorldMode = 'dm' | 'public';

/** Точка в единицах карты: [x, y], y растёт вниз. */
export type Vec2 = [number, number];

export interface Fact {
  label: string;
  /** Значение, отрендеренное как inline-Markdown (вики-ссылки работают). */
  html: string;
}

export interface EntityLocation {
  map: string;
  feature: string;
}

/** Картинка в двух размерах (URL относительно BASE_URL или абсолютный http-URL). */
export interface EntityImage {
  /** Квадратная миниатюра 128 px: кружок на карте, чипы, поиск. */
  thumb: string;
  /** Крупная версия (≤ 800 px) для панели статьи. */
  full: string;
}

export interface Entity {
  id: string;
  name: string;
  kind: Kind;
  /** Короткое описание (простой текст) для всплывающей карточки. Может быть пустым. */
  summary: string;
  /** Тело статьи, отрендеренное в HTML. */
  html: string;
  /** Родитель в иерархии (город → государство). */
  parent: string | null;
  /** id подробной карты (world/maps/<id>), если есть. */
  map: string | null;
  color: string | null;
  /** Эмодзи/символ вместо стандартного значка на карте. */
  icon: string | null;
  /** URL иллюстрации относительно BASE_URL (или абсолютный http-URL). */
  image: string | null;
  /** Портрет/аватар (кружок на карте, панель). */
  avatar: EntityImage | null;
  /** Место, к которому сущность привязана на карте (фронтматтер location). */
  location: string | null;
  /** Сущности, привязанные к этому месту (их location === id), по имени. */
  residents: string[];
  aliases: string[];
  tags: string[];
  facts: Fact[];
  visibility: Visibility;
  /** Сущности, у которых parent === id (отсортированы по типу, затем по имени). */
  children: string[];
  /** Сущности, ссылающиеся на эту через [[вики-ссылки]]. */
  backlinks: string[];
  /** Где сущность нарисована на картах (объекты и кружки-метки). */
  locations: EntityLocation[];
  /** Путь к .md относительно корня проекта — только в dev, в production-сборке null. */
  source: string | null;
}

export interface TileSource {
  /** Шаблон URL относительно BASE_URL: "generated/maps/world/{z}/{x}/{y}.webp". */
  url: string;
  tileSize: number;
  maxNativeZoom: number;
}

/**
 * Детальная врезка: арт высокого разрешения поверх части карты. Нарезана на той же сетке тайлов,
 * что и карта, и плавно проявляется при приближении (с краями, растушёванными в арт карты).
 */
export interface MapInset {
  id: string;
  title: string;
  /** [x, y, ширина, высота] в единицах карты. */
  bounds: [number, number, number, number];
  /** С этого зума врезка видна полностью; за INSET_FADE уровней до него — проявляется. */
  showFrom: number;
  /** null — детального арта ещё нет или он не нарезан (`npm run maps`). */
  tiles: (TileSource & { minNativeZoom: number }) | null;
  /** Хеш арта — для сброса кеша браузера. */
  version: string | null;
}

export interface MapBase {
  /** Превью всей карты (≤ 1024 px по большей стороне), URL относительно BASE_URL. */
  preview: string;
  tiles: TileSource;
  /** Хеш исходника — для сброса кеша браузера (?v=...). */
  version: string;
}

/** Свойства объекта ровно в том виде, как они записаны в features.geojson. */
export interface AuthoredFeatureProps {
  entity?: string | null;
  kind?: Kind | null;
  name?: string | null;
  detail?: DetailLevel | null;
  color?: string | null;
  visibility?: Visibility | null;
  /** Своя точка подписи области вместо автоматической. */
  labelAt?: Vec2 | null;
  /** Прочие поля сохраняются как есть. */
  [key: string]: unknown;
}

export interface MapFeature {
  /** Уникален в пределах карты. */
  id: string;
  entity: string | null;
  /** Итоговые значения: свойство объекта ?? свойство сущности ?? значение по умолчанию для типа. */
  kind: Kind;
  name: string;
  detail: DetailLevel;
  color: string | null;
  /** Геометрия как в файле (её правит редактор). */
  geometry: Geometry;
  /** Геометрия для отрисовки: области обрезаны по береговой линии (land.geojson). */
  display: Geometry;
  /** Точка для подписи области (полюс недоступности), для остальных null. */
  labelAt: Vec2 | null;
  /** Исходные свойства — редактор сохраняет их обратно без потерь. */
  props: AuthoredFeatureProps;
}

/**
 * Кружок с аватаром на карте: сущность с location, прикреплённая к объекту места на этой карте.
 * Если самого места на карте нет, берётся ближайший предок (таверна → город → государство).
 */
export interface MapPin {
  /** Уникален в пределах карты: "pin-<id сущности>". */
  id: string;
  entity: string;
  /** Сущность-якорь на этой карте: само место или его предок. */
  anchor: string;
  /** Объект якоря на этой карте. */
  feature: string;
  /** Точка якоря: сама точка, подпись области или середина линии. */
  at: Vec2;
  /** Детализация якоря: кружок виден, когда виден якорь. */
  detail: DetailLevel;
  /** above — над значком города, below — под подписью области. */
  placement: 'above' | 'below';
}

export interface MapDef {
  id: string;
  title: string;
  /** Пространство координат в единицах карты. */
  width: number;
  height: number;
  /** zoomBaseFor(width, height) — см. src/shared/zoom.ts. */
  zoomBase: number;
  /** Цвет фона вокруг карты. */
  background: string;
  /** null — арт ещё не нарезан (`npm run maps`). */
  base: MapBase | null;
  /** Сущность, которую изображает карта (город для карты города). */
  entity: string | null;
  /** Родительская карта (для «хлебных крошек»). */
  parent: string | null;
  visibility: Visibility;
  features: MapFeature[];
  /** Кружки сущностей, привязанных к местам на этой карте. */
  pins: MapPin[];
  /** Детальные врезки, от крупных к мелким (мелкие рисуются поверх). */
  insets: MapInset[];
  /** Путь к features.geojson относительно корня проекта — только в dev. */
  source: string | null;
}

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  /** Файл относительно корня проекта. */
  file: string | null;
}

export interface WorldData {
  mode: WorldMode;
  title: string;
  subtitle: string;
  defaultMap: string;
  maps: Record<string, MapDef>;
  entities: Record<string, Entity>;
  /** Проблемы в данных. В production-сборке ошибки останавливают сборку, а список пуст. */
  issues: Issue[];
}
