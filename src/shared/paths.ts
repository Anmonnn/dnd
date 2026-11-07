/**
 * Раскладка файлов проекта. Пути — относительно корня проекта, разделитель «/».
 * Модуль изоморфный (без node:path), чтобы его можно было импортировать и в браузере.
 */

/** Корень данных мира. */
export const WORLD_DIR = 'world';
/** Конфиг мира: название, карта по умолчанию. */
export const WORLD_CONFIG_FILE = 'world/world.json';
/** Лор: Markdown-файлы с фронтматтером (совместимо с Obsidian). */
export const LORE_DIR = 'world/lore';
/** Карты: по папке на карту — world/maps/<mapId>/. */
export const MAPS_DIR = 'world/maps';

/** Файлы внутри папки карты. */
export const MAP_CONFIG_FILE = 'map.json';
export const FEATURES_FILE = 'features.geojson';
export const LAND_FILE = 'land.geojson';

/** Сгенерированные тайлы и превью: public/generated/maps/<mapId>/ (в git не хранятся). */
export const GENERATED_MAPS_DIR = 'public/generated/maps';
/** Тот же каталог как URL относительно BASE_URL сайта. */
export const GENERATED_MAPS_URL = 'generated/maps';
/** Метаданные пирамиды тайлов, пишет `npm run maps`. */
export const TILES_META_FILE = 'meta.json';

/**
 * Детальные врезки карты: world/maps/<mapId>/insets/<insetId>/ — inset.json (где лежит),
 * source.png (детальный арт), reference.png (вырезка карты — образец для нейросети).
 */
export const INSETS_DIR = 'insets';
export const INSET_CONFIG_FILE = 'inset.json';
/** Тайлы врезок: public/generated/insets/<mapId>/<insetId>/{z}/{x}/{y}.webp + meta.json (генерируются). */
export const GENERATED_INSETS_DIR = 'public/generated/insets';
export const GENERATED_INSETS_URL = 'generated/insets';

/** Картинки мира (аватары, иллюстрации) можно класть куда угодно внутри world/; сюда редактор сохраняет загруженные аватары. */
export const WORLD_AVATARS_DIR = 'world/media/avatars';
/** Уменьшенные копии картинок: public/generated/media/<хеш>-<вариант>.webp (генерируются, в git не хранятся). */
export const GENERATED_MEDIA_DIR = 'public/generated/media';
export const GENERATED_MEDIA_URL = 'generated/media';

/** Допустимый id сущности/карты/объекта: латиница в нижнем регистре, цифры, дефисы. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
