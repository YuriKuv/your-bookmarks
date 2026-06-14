// plugins/favplus.js
// Lampa Favorite+ Plugin v1.0.0

(function() {
    // Конфигурация плагина
    const CONFIG = {
        version: '1.0.0',
        storagePrefix: 'favplus_',
        autoWatchThreshold: 5,      // 5% для авто-Смотрю
        autoViewedThreshold: 95,     // 95% для авто-Просмотрено
        autoThrownDays: 30,          // дней без активности для авто-Брошено
        autoViewedCleanupDays: 90,   // дней хранения в Просмотрено
        syncInterval: 60 * 60 * 1000, // 1 час
        gistFileName: 'lampa_favplus_data.json'
    };

    // Категории плагина
    const CATEGORIES = {
        BOOKMARK: 'book',     // Избранное (совместимость со штатным)
        LIKE: 'like',         // Нравится (совместимость)
        WATCH_LATER: 'wath',  // Позже (совместимость)
        HISTORY: 'history',   // История (совместимость)
        LOOK: 'look',         // Смотрю
        VIEWED: 'viewed',     // Просмотрено
        SCHEDULED: 'scheduled', // Буду смотреть
        THROWN: 'thrown',     // Брошено
        COLLECTION: 'collection' // Коллекция
    };

    // Приоритеты категорий для отображения (чем выше число, тем важнее)
    const CATEGORY_PRIORITY = {
        [CATEGORIES.LOOK]: 100,
        [CATEGORIES.VIEWED]: 90,
        [CATEGORIES.SCHEDULED]: 80,
        [CATEGORIES.BOOKMARK]: 70,
        [CATEGORIES.LIKE]: 60,
        [CATEGORIES.WATCH_LATER]: 50,
        [CATEGORIES.THROWN]: 40,
        [CATEGORIES.COLLECTION]: 30,
        [CATEGORIES.HISTORY]: 10
    };

    // Русские названия категорий
    const CATEGORY_NAMES = {
        [CATEGORIES.BOOKMARK]: 'Избранное',
        [CATEGORIES.LIKE]: 'Нравится',
        [CATEGORIES.WATCH_LATER]: 'Позже',
        [CATEGORIES.HISTORY]: 'История',
        [CATEGORIES.LOOK]: 'Смотрю',
        [CATEGORIES.VIEWED]: 'Просмотрено',
        [CATEGORIES.SCHEDULED]: 'Буду смотреть',
        [CATEGORIES.THROWN]: 'Брошено',
        [CATEGORIES.COLLECTION]: 'Коллекция'
    };

    // Иконки категорий для отображения
    const CATEGORY_ICONS = {
        [CATEGORIES.BOOKMARK]: 'bookmark',
        [CATEGORIES.LIKE]: 'heart',
        [CATEGORIES.WATCH_LATER]: 'clock',
        [CATEGORIES.HISTORY]: 'history',
        [CATEGORIES.LOOK]: 'eye',
        [CATEGORIES.VIEWED]: 'check-circle',
        [CATEGORIES.SCHEDULED]: 'calendar',
        [CATEGORIES.THROWN]: 'trash-2',
        [CATEGORIES.COLLECTION]: 'folder'
    };

    // Данные плагина
    let data = {
        logs: [],           // Лог действий
        customTimelines: {}, // Расширенные таймкоды
        sectionBookmarks: [], // Закладки разделов
        lastSync: 0,        // Время последней синхронизации
        gistId: null,       // ID Gist для синхронизации
        gistToken: null     // Токен GitHub
    };

    //=================================================================
    // 1. РАСШИРЕННОЕ ИЗБРАННОЕ (Smart Lists)
    //=================================================================

    /**
     * Сохранить лог действия
     */
    function addToLog(action, card, fromCategory, toCategory) {
        data.logs.unshift({
            timestamp: Date.now(),
            action: action, // 'add', 'remove', 'move', 'auto_move', 'auto_cleanup'
            cardId: card.id,
            cardTitle: card.title || card.name,
            cardType: card.original_name ? 'tv' : 'movie',
            fromCategory: fromCategory,
            toCategory: toCategory
        });

        // Ограничиваем лог 1000 записями
        if (data.logs.length > 1000) {
            data.logs = data.logs.slice(0, 1000);
        }

        saveData();
    }

    /**
     * Получить приоритетную категорию для карточки
     */
    function getPrimaryCategory(card) {
        let primary = null;
        let maxPriority = -1;

        for (const cat of Object.values(CATEGORIES)) {
            if (isInCategory(card, cat)) {
                const priority = CATEGORY_PRIORITY[cat] || 0;
                if (priority > maxPriority) {
                    maxPriority = priority;
                    primary = cat;
                }
            }
        }

        return primary;
    }

    /**
     * Автоматическое применение правил при добавлении в категорию
     */
    function applyAutoRules(card, targetCategory) {
        const rules = {
            // При добавлении в Просмотрено
            [CATEGORIES.VIEWED]: () => {
                if (isInCategory(card, CATEGORIES.LOOK)) {
                    removeFromCategory(card, CATEGORIES.LOOK);
                    addToLog('auto_move', card, CATEGORIES.LOOK, CATEGORIES.VIEWED);
                }
                if (isInCategory(card, CATEGORIES.SCHEDULED)) {
                    removeFromCategory(card, CATEGORIES.SCHEDULED);
                    addToLog('auto_move', card, CATEGORIES.SCHEDULED, CATEGORIES.VIEWED);
                }
            },
            // При добавлении в Смотрю
            [CATEGORIES.LOOK]: () => {
                if (isInCategory(card, CATEGORIES.SCHEDULED)) {
                    removeFromCategory(card, CATEGORIES.SCHEDULED);
                    addToLog('auto_move', card, CATEGORIES.SCHEDULED, CATEGORIES.LOOK);
                }
                if (isInCategory(card, CATEGORIES.THROWN)) {
                    removeFromCategory(card, CATEGORIES.THROWN);
                    addToLog('auto_move', card, CATEGORIES.THROWN, CATEGORIES.LOOK);
                }
            },
            // При добавлении в Брошено
            [CATEGORIES.THROWN]: () => {
                for (const cat of [CATEGORIES.LOOK, CATEGORIES.SCHEDULED, CATEGORIES.BOOKMARK, CATEGORIES.WATCH_LATER]) {
                    if (isInCategory(card, cat)) {
                        removeFromCategory(card, cat);
                        addToLog('auto_move', card, cat, CATEGORIES.THROWN);
                    }
                }
            }
        };

        if (rules[targetCategory]) {
            rules[targetCategory]();
        }
    }

    /**
     * Полное удаление карточки из всех категорий
     */
    function clearAllCategories(card) {
        const categoriesRemoved = [];

        for (const cat of Object.values(CATEGORIES)) {
            if (isInCategory(card, cat)) {
                removeFromCategory(card, cat);
                categoriesRemoved.push(cat);
            }
        }

        if (categoriesRemoved.length > 0) {
            addToLog('clear_all', card, categoriesRemoved.join(','), null);
        }

        // Также очищаем таймкоды
        clearTimelinesForCard(card);
    }

    /**
     * Получить все карточки из категории с дополнительной информацией
     */
    function getCategoryItems(category, filters = {}) {
        let items = Lampa.Favorite.get({type: category});

        // Фильтрация по типу
        if (filters.type === 'movie') {
            items = items.filter(item => !item.original_name);
        } else if (filters.type === 'tv') {
            items = items.filter(item => item.original_name);
        }

        // Сортировка
        if (filters.sort === 'title') {
            items.sort((a, b) => (a.title || a.name || '').localeCompare(b.title || b.name || ''));
        } else if (filters.sort === 'year') {
            items.sort((a, b) => {
                const yearA = parseInt((a.release_date || a.first_air_date || '0000').slice(0, 4));
                const yearB = parseInt((b.release_date || b.first_air_date || '0000').slice(0, 4));
                return yearB - yearA;
            });
        } else if (filters.sort === 'added') {
            // По умолчанию сортируем по времени добавления (хранится в favorite)
            items = items.reverse();
        }

        // Добавляем прогресс просмотра и первичную категорию
        items.forEach(item => {
            item.favplus_progress = getProgressForCard(item);
            item.favplus_primary = getPrimaryCategory(item);
        });

        return items;
    }

    //=================================================================
    // 2. ПРОДВИНУТЫЕ ТАЙМКОДЫ
    //=================================================================

    /**
     * Сформировать ключ для таймкода
     */
    function getTimelineKey(card, season = null, episode = null) {
        if (card.original_name && season !== null && episode !== null) {
            // Сериал: формат tmdbid_s1_e2
            return `${card.id}_s${season}_e${episode}`;
        } else if (card.original_name) {
            // Сериал без конкретной серии
            return `${card.id}_series`;
        } else {
            // Фильм
            return `${card.id}`;
        }
    }

    /**
     * Получить стандартный хеш Lampa
     */
    function getStandardHash(card, season = null, episode = null) {
        if (card.original_name && season !== null && episode !== null) {
            return Lampa.Utils.hash([season, season > 10 ? ':' : '', episode, card.original_name].join(''));
        } else if (card.original_name) {
            return Lampa.Utils.hash(card.original_name);
        } else {
            return Lampa.Utils.hash(card.original_title);
        }
    }

    /**
     * Сохранить таймкод (расширенный)
     */
    function saveTimeline(card, currentTime, duration, percent, season = null, episode = null) {
        const key = getTimelineKey(card, season, episode);
        const standardKey = getStandardHash(card, season, episode);
        const timestamp = Date.now();

        // Сохраняем расширенный таймкод
        if (!data.customTimelines[key]) {
            data.customTimelines[key] = {};
        }

        data.customTimelines[key] = {
            time: currentTime,
            duration: duration,
            percent: percent,
            updated: timestamp,
            season: season,
            episode: episode,
            cardId: card.id,
            cardTitle: card.title || card.name
        };

        // Сохраняем маппинг для сериалов
        if (card.original_name && season !== null && episode !== null) {
            if (!data.customTimelines[`${card.id}_mapping`]) {
                data.customTimelines[`${card.id}_mapping`] = {};
            }
            data.customTimelines[`${card.id}_mapping`][standardKey] = key;
        }

        // Синхронизируем со стандартным file_view Lampa
        const standardTimeline = Lampa.Timeline.view(standardKey);
        if (standardTimeline && standardTimeline.handler) {
            standardTimeline.handler(percent, currentTime, duration);
        }

        saveData();

        // Проверяем авто-статусы
        checkAutoStatuses(card, percent, season, episode);
    }

    /**
     * Получить таймкод для карточки
     */
    function getTimeline(card, season = null, episode = null) {
        const key = getTimelineKey(card, season, episode);
        return data.customTimelines[key] || null;
    }

    /**
     * Получить прогресс для карточки (в процентах)
     */
    function getProgressForCard(card) {
        if (card.original_name) {
            // Для сериала - максимальный прогресс среди серий
            let maxPercent = 0;
            const prefix = `${card.id}_s`;
            for (const key in data.customTimelines) {
                if (key.startsWith(prefix) && data.customTimelines[key].percent > maxPercent) {
                    maxPercent = data.customTimelines[key].percent;
                }
            }
            return maxPercent;
        } else {
            const timeline = getTimeline(card);
            return timeline ? timeline.percent : 0;
        }
    }

    /**
     * Очистить таймкоды для карточки
     */
    function clearTimelinesForCard(card) {
        const prefix = `${card.id}`;
        for (const key in data.customTimelines) {
            if (key.startsWith(prefix) || (data.customTimelines[key] && data.customTimelines[key].cardId === card.id)) {
                delete data.customTimelines[key];
            }
        }
        saveData();
    }

    /**
     * Удалить старые таймкоды (очистка)
     */
    function cleanupOldTimelines(daysToKeep = 90) {
        const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        let deleted = 0;

        for (const key in data.customTimelines) {
            if (data.customTimelines[key].updated && data.customTimelines[key].updated < cutoff) {
                delete data.customTimelines[key];
                deleted++;
            }
        }

        if (deleted > 0) {
            saveData();
            console.log(`[FavPlus] Cleaned up ${deleted} old timelines`);
        }
    }

    //=================================================================
    // 3. АВТОМАТИЧЕСКИЕ СТАТУСЫ
    //=================================================================

    /**
     * Проверить и применить авто-статусы на основе прогресса
     */
    async function checkAutoStatuses(card, percent, season, episode) {
        if (!card || !card.id) return;

        if (card.original_name) {
            // Сериал
            await checkSeriesAutoStatus(card, season, episode, percent);
        } else {
            // Фильм
            checkMovieAutoStatus(card, percent);
        }
    }

    /**
     * Авто-статусы для фильмов
     */
    function checkMovieAutoStatus(card, percent) {
        // Авто-Смотрю (достигнут порог 5%)
        if (percent >= CONFIG.autoWatchThreshold && !isInCategory(card, CATEGORIES.VIEWED)) {
            if (!isInCategory(card, CATEGORIES.LOOK)) {
                addToCategory(card, CATEGORIES.LOOK);
                addToLog('auto_move', card, null, CATEGORIES.LOOK);
            }
        }

        // Авто-Просмотрено (достигнут порог 95%)
        if (percent >= CONFIG.autoViewedThreshold) {
            if (!isInCategory(card, CATEGORIES.VIEWED)) {
                addToCategory(card, CATEGORIES.VIEWED);
                addToLog('auto_move', card, null, CATEGORIES.VIEWED);
            }
        }
    }

    /**
     * Авто-статусы для сериалов
     */
    async function checkSeriesAutoStatus(card, season, episode, percent) {
        // Авто-Смотрю (просмотрена хотя бы одна серия)
        if (percent >= CONFIG.autoWatchThreshold && !isInCategory(card, CATEGORIES.VIEWED)) {
            if (!isInCategory(card, CATEGORIES.LOOK)) {
                addToCategory(card, CATEGORIES.LOOK);
                addToLog('auto_move', card, null, CATEGORIES.LOOK);
            }
        }

        // Проверка на завершение сериала
        const isLastEpisode = await checkIfLastEpisode(card, season, episode);
        if (isLastEpisode && percent >= CONFIG.autoViewedThreshold) {
            if (!isInCategory(card, CATEGORIES.VIEWED)) {
                addToCategory(card, CATEGORIES.VIEWED);
                addToLog('auto_move', card, null, CATEGORIES.VIEWED);
            }
        }
    }

    /**
     * Проверить, является ли серия последней в сериале
     */
    async function checkIfLastEpisode(card, season, episode) {
        return new Promise((resolve) => {
            // Пытаемся получить данные через TimeTable или TMDB
            Lampa.Timetable.get(card, (episodes) => {
                if (episodes && episodes.length > 0) {
                    // Находим последний сезон
                    const seasons = {};
                    episodes.forEach(ep => {
                        if (!seasons[ep.season_number]) {
                            seasons[ep.season_number] = [];
                        }
                        seasons[ep.season_number].push(ep.episode_number);
                    });

                    const lastSeason = Math.max(...Object.keys(seasons).map(Number));
                    const lastEpisode = Math.max(...seasons[lastSeason]);

                    resolve(season === lastSeason && episode === lastEpisode);
                } else {
                    resolve(false);
                }
            });
        });
    }

    /**
     * Авто-Брошено (запускается по таймеру)
     */
    function checkAutoThrown() {
        const cutoff = Date.now() - (CONFIG.autoThrownDays * 24 * 60 * 60 * 1000);
        const lookItems = Lampa.Favorite.get({type: CATEGORIES.LOOK});

        lookItems.forEach(card => {
            // Получаем последнее обновление таймкода для карточки
            let lastUpdate = 0;
            const prefix = `${card.id}`;

            for (const key in data.customTimelines) {
                if (key.startsWith(prefix) && data.customTimelines[key].updated > lastUpdate) {
                    lastUpdate = data.customTimelines[key].updated;
                }
            }

            if (lastUpdate > 0 && lastUpdate < cutoff) {
                // Перемещаем в Брошено
                removeFromCategory(card, CATEGORIES.LOOK);
                addToCategory(card, CATEGORIES.THROWN);
                addToLog('auto_cleanup', card, CATEGORIES.LOOK, CATEGORIES.THROWN);
            }
        });
    }

    /**
     * Очистка старых Просмотрено
     */
    function cleanupOldViewed() {
        const cutoff = Date.now() - (CONFIG.autoViewedCleanupDays * 24 * 60 * 60 * 1000);
        const viewedItems = Lampa.Favorite.get({type: CATEGORIES.VIEWED});

        viewedItems.forEach(card => {
            // Проверяем, когда был завершен просмотр
            let completedAt = 0;
            const timeline = getTimeline(card);

            if (timeline && timeline.percent >= CONFIG.autoViewedThreshold) {
                completedAt = timeline.updated;
            }

            if (completedAt > 0 && completedAt < cutoff) {
                removeFromCategory(card, CATEGORIES.VIEWED);
                addToLog('auto_cleanup', card, CATEGORIES.VIEWED, null);
            }
        });
    }

    //=================================================================
    // 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ РАБОТЫ С КАТЕГОРИЯМИ
    //=================================================================

    function isInCategory(card, category) {
        const items = Lampa.Favorite.get({type: category});
        return items.some(item => item.id === card.id);
    }

    function addToCategory(card, category) {
        if (!isInCategory(card, category)) {
            Lampa.Favorite.add(category, card);
        }
    }

    function removeFromCategory(card, category) {
        if (isInCategory(card, category)) {
            Lampa.Favorite.remove(category, card);
        }
    }

    //=================================================================
    // 5. ХРАНЕНИЕ ДАННЫХ
    //=================================================================

    function saveData() {
        const toSave = {
            logs: data.logs,
            customTimelines: data.customTimelines,
            sectionBookmarks: data.sectionBookmarks,
            lastSync: data.lastSync,
            gistId: data.gistId,
            gistToken: data.gistToken,
            settings: {
                autoWatchThreshold: CONFIG.autoWatchThreshold,
                autoViewedThreshold: CONFIG.autoViewedThreshold,
                autoThrownDays: CONFIG.autoThrownDays,
                autoViewedCleanupDays: CONFIG.autoViewedCleanupDays
            }
        };
        Lampa.Storage.set(CONFIG.storagePrefix + 'data', toSave);
    }

    function loadData() {
        const saved = Lampa.Storage.get(CONFIG.storagePrefix + 'data', {});
        data.logs = saved.logs || [];
        data.customTimelines = saved.customTimelines || {};
        data.sectionBookmarks = saved.sectionBookmarks || [];
        data.lastSync = saved.lastSync || 0;
        data.gistId = saved.gistId || null;
        data.gistToken = saved.gistToken || null;

        if (saved.settings) {
            CONFIG.autoWatchThreshold = saved.settings.autoWatchThreshold || 5;
            CONFIG.autoViewedThreshold = saved.settings.autoViewedThreshold || 95;
            CONFIG.autoThrownDays = saved.settings.autoThrownDays || 30;
            CONFIG.autoViewedCleanupDays = saved.settings.autoViewedCleanupDays || 90;
        }
    }

    //=================================================================
    // 6. GITHUB GIST СИНХРОНИЗАЦИЯ
    //=================================================================

    async function syncWithGist() {
        if (!data.gistId || !data.gistToken) {
            console.log('[FavPlus] Gist sync not configured');
            return false;
        }

        try {
            // Собираем данные для синхронизации
            const syncData = {
                version: CONFIG.version,
                timestamp: Date.now(),
                categories: {},
                timelines: data.customTimelines,
                bookmarks: data.sectionBookmarks
            };

            // Собираем все категории
            for (const cat of Object.values(CATEGORIES)) {
                syncData.categories[cat] = Lampa.Favorite.get({type: cat}).map(item => ({
                    id: item.id,
                    title: item.title || item.name,
                    type: item.original_name ? 'tv' : 'movie'
                }));
            }

            // Загружаем текущий Gist
            const gistUrl = `https://api.github.com/gists/${data.gistId}`;
            const response = await fetch(gistUrl, {
                headers: {
                    'Authorization': `token ${data.gistToken}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const gist = await response.json();
            const filename = CONFIG.gistFileName;
            const existingContent = gist.files[filename] ? JSON.parse(gist.files[filename].content) : null;

            // Стратегия слияния
            let mergedData = syncData;

            if (existingContent) {
                if (Lampa.Storage.get(CONFIG.storagePrefix + 'sync_strategy', 'duration') === 'duration') {
                    // По длительности: берем таймкод с большей длительностью
                    mergedData = mergeByDuration(existingContent, syncData);
                } else {
                    // По дате: берем свежее
                    mergedData = existingContent.timestamp > syncData.timestamp ? existingContent : syncData;
                }
            }

            // Обновляем Gist
            const updateResponse = await fetch(gistUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${data.gistToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    files: {
                        [filename]: {
                            content: JSON.stringify(mergedData, null, 2)
                        }
                    }
                })
            });

            if (!updateResponse.ok) throw new Error(`HTTP ${updateResponse.status}`);

            // Применяем полученные данные локально
            await applySyncedData(mergedData);

            data.lastSync = Date.now();
            saveData();

            console.log('[FavPlus] Sync completed successfully');
            return true;

        } catch (error) {
            console.error('[FavPlus] Sync failed:', error);
            return false;
        }
    }

    function mergeByDuration(existing, incoming) {
        const result = JSON.parse(JSON.stringify(incoming));

        // Слияние таймкодов: берем тот, у которого больше длительность
        for (const key in existing.timelines) {
            if (result.timelines[key]) {
                if (existing.timelines[key].duration > result.timelines[key].duration) {
                    result.timelines[key] = existing.timelines[key];
                }
            } else {
                result.timelines[key] = existing.timelines[key];
            }
        }

        // Слияние категорий: объединяем без дубликатов
        for (const cat in existing.categories) {
            if (!result.categories[cat]) {
                result.categories[cat] = [];
            }
            const existingIds = new Set(result.categories[cat].map(i => i.id));
            for (const item of existing.categories[cat]) {
                if (!existingIds.has(item.id)) {
                    result.categories[cat].push(item);
                }
            }
        }

        return result;
    }

    async function applySyncedData(syncedData) {
        if (!syncedData || !syncedData.categories) return;

        // Восстанавливаем категории
        for (const cat of Object.values(CATEGORIES)) {
            if (syncedData.categories[cat]) {
                const currentIds = new Set(Lampa.Favorite.get({type: cat}).map(i => i.id));
                for (const item of syncedData.categories[cat]) {
                    if (!currentIds.has(item.id)) {
                        // Создаем минимальную карточку для добавления
                        const card = {id: item.id, title: item.title, name: item.title};
                        if (item.type === 'tv') card.original_name = item.title;
                        Lampa.Favorite.add(cat, card);
                    }
                }
            }
        }

        // Восстанавливаем таймкоды
        if (syncedData.timelines) {
            for (const key in syncedData.timelines) {
                if (!data.customTimelines[key] ||
                    syncedData.timelines[key].duration > data.customTimelines[key].duration) {
                    data.customTimelines[key] = syncedData.timelines[key];
                }
            }
        }

        // Восстанавливаем закладки разделов
        if (syncedData.bookmarks) {
            data.sectionBookmarks = syncedData.bookmarks;
        }

        saveData();
    }

    //=================================================================
    // 7. ЗАКЛАДКИ РАЗДЕЛОВ
    //=================================================================

    function saveCurrentSection() {
        const activity = Lampa.Activity.active();
        if (!activity) return false;

        const bookmark = {
            id: Date.now().toString(),
            title: activity.title || 'Неизвестный раздел',
            url: activity.url,
            component: activity.component,
            source: activity.source,
            genres: activity.genres,
            query: activity.query,
            page: activity.page || 1,
            timestamp: Date.now()
        };

        data.sectionBookmarks.unshift(bookmark);

        // Ограничиваем количество
        if (data.sectionBookmarks.length > 50) {
            data.sectionBookmarks = data.sectionBookmarks.slice(0, 50);
        }

        saveData();
        return bookmark;
    }

    function removeSectionBookmark(id) {
        data.sectionBookmarks = data.sectionBookmarks.filter(b => b.id !== id);
        saveData();
    }

    function restoreSectionBookmark(bookmark) {
        Lampa.Activity.push({
            url: bookmark.url || '',
            title: bookmark.title,
            component: bookmark.component || 'category_full',
            source: bookmark.source,
            genres: bookmark.genres,
            query: bookmark.query,
            page: bookmark.page || 1
        });
    }

    //=================================================================
    // 8. ВИЗУАЛЬНЫЕ КОМПОНЕНТЫ
    //=================================================================

    /**
     * Добавить статус на карточку
     */
    function addStatusToCard() {
        // Сохраняем оригинальный метод создания карточки
        const originalCardCreate = Lampa.Card.prototype.create;

        Lampa.Card.prototype.create = function() {
            originalCardCreate.call(this);

            // Получаем данные карточки
            const cardData = this.data;
            const primaryCategory = getPrimaryCategory(cardData);
            const progress = getProgressForCard(cardData);

            if (primaryCategory || progress > 0) {
                // Создаем блок статуса
                const statusBlock = Lampa.Template.elem('div', {
                    class: 'favplus-card-status'
                });

                // Добавляем иконку категории
                if (primaryCategory && CATEGORY_ICONS[primaryCategory]) {
                    const iconSpan = Lampa.Template.elem('span', {
                        class: `favplus-status-icon favplus-icon-${CATEGORY_ICONS[primaryCategory]}`
                    });
                    statusBlock.appendChild(iconSpan);

                    const textSpan = Lampa.Template.elem('span', {
                        class: 'favplus-status-text',
                        text: CATEGORY_NAMES[primaryCategory]
                    });
                    statusBlock.appendChild(textSpan);
                }

                // Добавляем прогресс для сериалов
                if (cardData.original_name && progress > 0 && progress < 100) {
                    const progressSpan = Lampa.Template.elem('span', {
                        class: 'favplus-status-progress',
                        text: `${Math.round(progress)}%`
                    });
                    statusBlock.appendChild(progressSpan);
                }

                // Добавляем блок на карточку
                const posterElement = this.html.querySelector('.card__poster, .card__view');
                if (posterElement) {
                    posterElement.appendChild(statusBlock);
                }
            }
        };
    }

    /**
     * Модифицировать страницу фильма
     */
    function modifyFullPage() {
        Lampa.Listener.follow('full', (event) => {
            if (event.type === 'complite') {
                const fullComponent = event.link;
                const card = event.data.movie;
                const primaryCategory = getPrimaryCategory(card);

                // Находим контейнер для кнопок
                const buttonsContainer = fullComponent.html.querySelector('.full-start-new__buttons');
                if (!buttonsContainer) return;

                // Находим штатную кнопку закладки
                const originalBookmarkBtn = buttonsContainer.querySelector('.button--book');
                if (originalBookmarkBtn && Lampa.Storage.get(CONFIG.storagePrefix + 'hide_original_bookmark', false)) {
                    originalBookmarkBtn.classList.add('hide');
                }

                // Добавляем блок статуса
                let statusContainer = fullComponent.html.querySelector('.favplus-full-status');
                if (!statusContainer) {
                    const ratingLine = fullComponent.html.querySelector('.full-start-new__rate-line');
                    if (ratingLine) {
                        statusContainer = Lampa.Template.elem('div', {
                            class: 'favplus-full-status'
                        });
                        ratingLine.insertAdjacentElement('afterend', statusContainer);
                    }
                }

                if (statusContainer && primaryCategory) {
                    statusContainer.innerHTML = `
                        <div class="favplus-full-status-item">
                            <span class="favplus-full-icon favplus-icon-${CATEGORY_ICONS[primaryCategory]}"></span>
                            <span class="favplus-full-text">${CATEGORY_NAMES[primaryCategory]}</span>
                        </div>
                    `;
                }

                // Заменяем кнопку закладки на выпадающее меню
                if (originalBookmarkBtn && !originalBookmarkBtn.querySelector('.favplus-dropdown-trigger')) {
                    // Создаем новую кнопку с меню
                    const newButton = Lampa.Template.elem('div', {
                        class: 'full-start__button selector favplus-dropdown-btn'
                    });

                    newButton.innerHTML = `
                        <svg width="21" height="32" viewBox="0 0 21 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2 1.5H19C19.2761 1.5 19.5 1.72386 19.5 2V27.9618C19.5 28.3756 19.0261 28.6103 18.697 28.3595L12.6212 23.7303C11.3682 22.7757 9.63183 22.7757 8.37885 23.7303L2.30302 28.3595C1.9739 28.6103 1.5 28.3756 1.5 27.9618V2C1.5 1.72386 1.72386 1.5 2 1.5Z" stroke="currentColor" stroke-width="2.5"/>
                        </svg>
                        <span class="favplus-dropdown-trigger">В избранное+</span>
                    `;

                    originalBookmarkBtn.parentNode.insertBefore(newButton, originalBookmarkBtn);
                    originalBookmarkBtn.classList.add('hide');

                    // Добавляем обработчик для выпадающего меню
                    newButton.addEventListener('hover:enter', () => {
                        showCategoryMenu(card, newButton);
                    });
                }
            }
        });
    }

    /**
     * Показать меню выбора категории
     */
    function showCategoryMenu(card, buttonElement) {
        const items = [];

        for (const cat of Object.values(CATEGORIES)) {
            const isChecked = isInCategory(card, cat);
            items.push({
                title: CATEGORY_NAMES[cat],
                category: cat,
                checkbox: true,
                checked: isChecked,
                onCheck: (item) => {
                    if (item.checked) {
                        addToCategory(card, item.category);
                        applyAutoRules(card, item.category);
                        addToLog('add', card, null, item.category);
                    } else {
                        removeFromCategory(card, item.category);
                        addToLog('remove', card, item.category, null);
                    }
                }
            });
        }

        items.push({separator: true});
        items.push({
            title: 'Очистить всё',
            onSelect: () => {
                clearAllCategories(card);
            }
        });
        items.push({
            title: 'Очистить таймкоды',
            onSelect: () => {
                clearTimelinesForCard(card);
            }
        });

        Lampa.Select.show({
            title: card.title || card.name,
            items: items,
            onBack: () => {
                Lampa.Controller.toggle('full_start');
            }
        });
    }

    //=================================================================
    // 9. ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ
    //=================================================================

    function addMenuItem() {
        Lampa.Menu.addButton(
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15 8H22L16 12L19 18L12 14L5 18L8 12L2 8H9L12 2Z" fill="currentColor"/></svg>',
            'Избранное+',
            () => {
                openFavPlusPanel();
            }
        );
    }

    /**
     * Открыть главную панель Избранное+
     */
    function openFavPlusPanel() {
        const items = [];

        // Добавляем пункты для всех категорий
        const displayCategories = [
            CATEGORIES.LOOK, CATEGORIES.VIEWED, CATEGORIES.SCHEDULED,
            CATEGORIES.THROWN, CATEGORIES.BOOKMARK, CATEGORIES.LIKE,
            CATEGORIES.WATCH_LATER, CATEGORIES.COLLECTION
        ];

        for (const cat of displayCategories) {
            const count = Lampa.Favorite.get({type: cat}).length;
            items.push({
                title: CATEGORY_NAMES[cat],
                subtitle: `${count} элементов`,
                category: cat,
                onSelect: () => {
                    openCategoryView(cat);
                }
            });
        }

        items.push({separator: true});
        items.push({
            title: 'Продолжить просмотр',
            onSelect: () => {
                continueWatching();
            }
        });
        items.push({
            title: 'Случайный фильм',
            onSelect: () => {
                openRandomMovie();
            }
        });
        items.push({
            title: 'Статистика',
            onSelect: () => {
                showStatistics();
            }
        });
        items.push({
            title: 'Настройки',
            onSelect: () => {
                openSettings();
            }
        });

        Lampa.Select.show({
            title: 'Избранное+',
            items: items,
            onBack: () => {
                Lampa.Controller.toggle('menu');
            }
        });
    }

    /**
     * Открыть просмотр категории
     */
    function openCategoryView(category) {
        const items = getCategoryItems(category);

        const selectItems = items.map(item => ({
            title: item.title || item.name,
            subtitle: item.original_name ? 'Сериал' : 'Фильм',
            card: item,
            onSelect: () => {
                Lampa.Activity.push({
                    url: '',
                    component: 'full',
                    id: item.id,
                    method: item.original_name ? 'tv' : 'movie',
                    card: item
                });
            }
        }));

        Lampa.Select.show({
            title: CATEGORY_NAMES[category],
            items: selectItems,
            onBack: () => {
                openFavPlusPanel();
            }
        });
    }

    /**
     * Продолжить просмотр последнего
     */
    function continueWatching() {
        let lastWatched = null;
        let lastTime = 0;

        for (const key in data.customTimelines) {
            const tl = data.customTimelines[key];
            if (tl.updated > lastTime && tl.percent < 95 && tl.percent > 0) {
                lastTime = tl.updated;
                lastWatched = tl;
            }
        }

        if (lastWatched) {
            // Находим карточку по ID
            const card = {id: lastWatched.cardId, title: lastWatched.cardTitle};
            if (lastWatched.season) card.original_name = lastWatched.cardTitle;

            Lampa.Activity.push({
                url: '',
                component: 'full',
                id: lastWatched.cardId,
                method: lastWatched.season ? 'tv' : 'movie',
                card: card
            });
        } else {
            Lampa.Noty.show('Нет незавершенных просмотров');
        }
    }

    /**
     * Открыть случайный фильм
     */
    function openRandomMovie() {
        const lookItems = getCategoryItems(CATEGORIES.LOOK);
        const scheduledItems = getCategoryItems(CATEGORIES.SCHEDULED);
        const all = [...lookItems, ...scheduledItems];

        if (all.length === 0) {
            Lampa.Noty.show('Нет фильмов в списках');
            return;
        }

        const random = all[Math.floor(Math.random() * all.length)];
        Lampa.Activity.push({
            url: '',
            component: 'full',
            id: random.id,
            method: random.original_name ? 'tv' : 'movie',
            card: random
        });
    }

    /**
     * Показать статистику
     */
    function showStatistics() {
        let totalTime = 0;
        let totalMovies = 0;
        let totalEpisodes = 0;
        const topByTime = [];

        for (const key in data.customTimelines) {
            const tl = data.customTimelines[key];
            if (tl.duration && tl.percent) {
                const watchedTime = tl.duration * (tl.percent / 100);
                totalTime += watchedTime;

                if (tl.season) {
                    totalEpisodes++;
                } else {
                    totalMovies++;
                }

                // Топ-5 по времени
                topByTime.push({
                    title: tl.cardTitle,
                    time: watchedTime,
                    percent: tl.percent
                });
            }
        }

        topByTime.sort((a, b) => b.time - a.time);
        const top5 = topByTime.slice(0, 5);

        const hours = Math.floor(totalTime / 3600);
        const minutes = Math.floor((totalTime % 3600) / 60);

        let statsHtml = `
            <div style="padding: 1em; line-height: 1.8;">
                <div><strong>Общее время:</strong> ${hours}ч ${minutes}м</div>
                <div><strong>Фильмов просмотрено:</strong> ${totalMovies}</div>
                <div><strong>Серий просмотрено:</strong> ${totalEpisodes}</div>
                <div style="margin-top: 1em;"><strong>Топ-5 по времени:</strong></div>
                <div style="font-size: 0.9em;">
        `;

        top5.forEach((item, i) => {
            const itemHours = Math.floor(item.time / 3600);
            const itemMins = Math.floor((item.time % 3600) / 60);
            statsHtml += `<div>${i+1}. ${item.title} — ${itemHours}ч ${itemMins}м (${Math.round(item.percent)}%)</div>`;
        });

        statsHtml += `</div></div>`;

        Lampa.Modal.open({
            title: 'Статистика просмотров',
            html: $(statsHtml),
            size: 'medium',
            onBack: () => {
                Lampa.Modal.close();
                openFavPlusPanel();
            }
        });
    }

    //=================================================================
    // 10. НАСТРОЙКИ ПЛАГИНА
    //=================================================================

    function openSettings() {
        const items = [
            {
                title: 'Авто-Смотрю',
                subtitle: `Порог: ${CONFIG.autoWatchThreshold}%`,
                setting: 'autoWatchThreshold',
                type: 'range',
                min: 1, max: 20
            },
            {
                title: 'Авто-Просмотрено',
                subtitle: `Порог: ${CONFIG.autoViewedThreshold}%`,
                setting: 'autoViewedThreshold',
                type: 'range',
                min: 80, max: 100
            },
            {
                title: 'Авто-Брошено (дней)',
                subtitle: `${CONFIG.autoThrownDays} дней`,
                setting: 'autoThrownDays',
                type: 'range',
                min: 7, max: 90
            },
            {
                title: 'Очистка просмотренных (дней)',
                subtitle: `${CONFIG.autoViewedCleanupDays} дней`,
                setting: 'autoViewedCleanupDays',
                type: 'range',
                min: 30, max: 365
            },
            {separator: true},
            {
                title: 'Скрыть штатную кнопку',
                checkbox: true,
                checked: Lampa.Storage.get(CONFIG.storagePrefix + 'hide_original_bookmark', false),
                setting: 'hide_original_bookmark'
            },
            {separator: true},
            {
                title: 'GitHub Token',
                subtitle: data.gistToken ? 'Установлен' : 'Не установлен',
                setting: 'gistToken'
            },
            {
                title: 'Gist ID',
                subtitle: data.gistId || 'Не указан',
                setting: 'gistId'
            },
            {
                title: 'Синхронизировать сейчас',
                onSelect: () => {
                    syncWithGist().then(success => {
                        if (success) {
                            Lampa.Noty.show('Синхронизация выполнена');
                        } else {
                            Lampa.Noty.show('Ошибка синхронизации');
                        }
                        openSettings();
                    });
                }
            }
        ];

        Lampa.Select.show({
            title: 'Настройки Избранное+',
            items: items,
            onCheck: (item) => {
                if (item.setting === 'hide_original_bookmark') {
                    Lampa.Storage.set(CONFIG.storagePrefix + item.setting, item.checked);
                }
            },
            onSelect: (item) => {
                if (item.setting === 'gistToken') {
                    Lampa.Input.edit({
                        title: 'Введите GitHub Token',
                        value: data.gistToken || '',
                        free: true
                    }, (value) => {
                        if (value) {
                            data.gistToken = value;
                            saveData();
                        }
                        openSettings();
                    });
                } else if (item.setting === 'gistId') {
                    Lampa.Input.edit({
                        title: 'Введите Gist ID',
                        value: data.gistId || '',
                        free: true
                    }, (value) => {
                        if (value) {
                            data.gistId = value;
                            saveData();
                        }
                        openSettings();
                    });
                } else if (item.type === 'range') {
                    showRangePicker(item);
                }
            },
            onBack: () => {
                openFavPlusPanel();
            }
        });
    }

    function showRangePicker(item) {
        const items = [];
        for (let i = item.min; i <= item.max; i++) {
            items.push({
                title: `${i}${item.setting === 'autoThrownDays' ? ' дней' : '%'}`,
                value: i,
                selected: CONFIG[item.setting] === i
            });
        }

        Lampa.Select.show({
            title: item.title,
            items: items,
            onSelect: (selected) => {
                CONFIG[item.setting] = selected.value;
                saveData();
                openSettings();
            },
            onBack: () => {
                openSettings();
            }
        });
    }

    //=================================================================
    // 11. ИНИЦИАЛИЗАЦИЯ ПЛАГИНА
    //=================================================================

    function init() {
        console.log(`[FavPlus] Initializing v${CONFIG.version}`);

        // Загружаем сохраненные данные
        loadData();

        // Расширяем Favorite методами
        Lampa.Favorite.clearAll = clearAllCategories;
        Lampa.Favorite.getPrimary = getPrimaryCategory;
        Lampa.Favorite.getWithProgress = getCategoryItems;

        // Расширяем Timeline
        Lampa.Timeline.saveExtended = saveTimeline;
        Lampa.Timeline.getExtended = getTimeline;

        // Добавляем визуальные компоненты
        addStatusToCard();
        modifyFullPage();

        // Добавляем пункт в меню
        addMenuItem();

        // Подписываемся на события плеера для сохранения таймкодов
        Lampa.Player.listener.follow('timeupdate', (data) => {
            const activity = Lampa.Activity.active();
            if (activity && activity.movie) {
                const card = activity.movie;
                const currentTime = data.current || 0;
                const duration = data.duration || 0;
                const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

                // Получаем информацию о сезоне/серии из плеера
                const playData = Lampa.Player.playdata();
                const season = playData ? playData.season : null;
                const episode = playData ? playData.episode : null;

                saveTimeline(card, currentTime, duration, percent, season, episode);
            }
        });

        // Запускаем фоновые задачи
        setInterval(() => {
            checkAutoThrown();
            cleanupOldTimelines();
            cleanupOldViewed();

            // Периодическая синхронизация
            if (data.gistId && data.gistToken && (Date.now() - data.lastSync) > CONFIG.syncInterval) {
                syncWithGist();
            }
        }, 60 * 60 * 1000); // Раз в час

        // Синхронизация при старте
        if (data.gistId && data.gistToken) {
            setTimeout(() => syncWithGist(), 5000);
        }

        console.log('[FavPlus] Initialized successfully');
    }

    // Запускаем плагин после готовности приложения
    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') {
                init();
            }
        });
    }

})();
