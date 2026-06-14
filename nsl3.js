// plugins/favplus.js
// Lampa Favorite+ Plugin v1.0.1 - Исправленная версия

(function() {
    // Конфигурация плагина
    const CONFIG = {
        version: '1.0.1',
        storagePrefix: 'favplus_',
        autoWatchThreshold: 5,
        autoViewedThreshold: 95,
        autoThrownDays: 30,
        autoViewedCleanupDays: 90,
        syncInterval: 60 * 60 * 1000,
        gistFileName: 'lampa_favplus_data.json'
    };

    // Категории плагина (только новые, штатные не трогаем)
    const EXTRA_CATEGORIES = {
        LOOK: 'look',
        VIEWED: 'viewed',
        SCHEDULED: 'scheduled',
        THROWN: 'thrown',
        COLLECTION: 'collection'
    };

    // Штатные категории Lampa
    const STOCK_CATEGORIES = {
        BOOKMARK: 'book',
        LIKE: 'like',
        WATCH_LATER: 'wath',
        HISTORY: 'history'
    };

    // Все категории
    const ALL_CATEGORIES = {...STOCK_CATEGORIES, ...EXTRA_CATEGORIES};

    // Приоритеты категорий
    const CATEGORY_PRIORITY = {
        [EXTRA_CATEGORIES.LOOK]: 100,
        [EXTRA_CATEGORIES.VIEWED]: 90,
        [EXTRA_CATEGORIES.SCHEDULED]: 80,
        [STOCK_CATEGORIES.BOOKMARK]: 70,
        [STOCK_CATEGORIES.LIKE]: 60,
        [STOCK_CATEGORIES.WATCH_LATER]: 50,
        [EXTRA_CATEGORIES.THROWN]: 40,
        [EXTRA_CATEGORIES.COLLECTION]: 30,
        [STOCK_CATEGORIES.HISTORY]: 10
    };

    const CATEGORY_NAMES = {
        [STOCK_CATEGORIES.BOOKMARK]: 'Избранное',
        [STOCK_CATEGORIES.LIKE]: 'Нравится',
        [STOCK_CATEGORIES.WATCH_LATER]: 'Позже',
        [STOCK_CATEGORIES.HISTORY]: 'История',
        [EXTRA_CATEGORIES.LOOK]: 'Смотрю',
        [EXTRA_CATEGORIES.VIEWED]: 'Просмотрено',
        [EXTRA_CATEGORIES.SCHEDULED]: 'Буду смотреть',
        [EXTRA_CATEGORIES.THROWN]: 'Брошено',
        [EXTRA_CATEGORIES.COLLECTION]: 'Коллекция'
    };

    // Данные плагина
    let data = {
        logs: [],
        customTimelines: {},
        sectionBookmarks: [],
        lastSync: 0,
        gistId: null,
        gistToken: null
    };

    // Инициализация дополнительных категорий в Lampa.Favorite
    function initExtraCategories() {
        // Проверяем и создаем дополнительные категории в Storage
        for (const cat of Object.values(EXTRA_CATEGORIES)) {
            const items = Lampa.Storage.get('favorite', {});
            if (!items[cat]) {
                const favData = Lampa.Storage.get('favorite', {});
                favData[cat] = [];
                Lampa.Storage.set('favorite', favData);
            }
        }
    }

    // Безопасное получение элементов категории
    function getCategoryItemsSafe(category) {
        try {
            const favData = Lampa.Storage.get('favorite', {});
            return favData[category] || [];
        } catch(e) {
            console.warn('[FavPlus] Error getting category:', category, e);
            return [];
        }
    }

    // Сохранение элементов категории
    function setCategoryItemsSafe(category, items) {
        try {
            const favData = Lampa.Storage.get('favorite', {});
            favData[category] = items;
            Lampa.Storage.set('favorite', favData);
        } catch(e) {
            console.warn('[FavPlus] Error saving category:', category, e);
        }
    }

    // Проверка наличия карточки в категории
    function isInCategory(card, category) {
        if (!card || !card.id) return false;
        const items = getCategoryItemsSafe(category);
        return items.some(item => item.id === card.id);
    }

    // Получение карточки из категории по ID
    function getCardFromCategory(category, cardId) {
        const items = getCategoryItemsSafe(category);
        return items.find(item => item.id === cardId);
    }

    // Добавление в категорию
    function addToCategory(card, category) {
        if (!card || !card.id) return false;
        if (isInCategory(card, category)) return false;

        const items = getCategoryItemsSafe(category);
        items.unshift(card);
        setCategoryItemsSafe(category, items);

        addToLog('add', card, null, category);
        return true;
    }

    // Удаление из категории
    function removeFromCategory(card, category) {
        if (!card || !card.id) return false;
        if (!isInCategory(card, category)) return false;

        const items = getCategoryItemsSafe(category);
        const filtered = items.filter(item => item.id !== card.id);
        setCategoryItemsSafe(category, filtered);

        addToLog('remove', card, category, null);
        return true;
    }

    // Получение первичной категории для карточки
    function getPrimaryCategory(card) {
        if (!card || !card.id) return null;

        let primary = null;
        let maxPriority = -1;

        for (const [cat, priority] of Object.entries(CATEGORY_PRIORITY)) {
            if (isInCategory(card, cat)) {
                if (priority > maxPriority) {
                    maxPriority = priority;
                    primary = cat;
                }
            }
        }

        return primary;
    }

    // Сохранение лога
    function addToLog(action, card, fromCategory, toCategory) {
        if (!card) return;

        data.logs.unshift({
            timestamp: Date.now(),
            action: action,
            cardId: card.id,
            cardTitle: card.title || card.name || 'Unknown',
            cardType: card.original_name ? 'tv' : 'movie',
            fromCategory: fromCategory,
            toCategory: toCategory
        });

        if (data.logs.length > 500) {
            data.logs = data.logs.slice(0, 500);
        }

        saveData();
    }

    // Применение правил при добавлении
    function applyAutoRules(card, targetCategory) {
        if (!card) return;

        if (targetCategory === EXTRA_CATEGORIES.VIEWED) {
            if (isInCategory(card, EXTRA_CATEGORIES.LOOK)) {
                removeFromCategory(card, EXTRA_CATEGORIES.LOOK);
            }
            if (isInCategory(card, EXTRA_CATEGORIES.SCHEDULED)) {
                removeFromCategory(card, EXTRA_CATEGORIES.SCHEDULED);
            }
        }
        else if (targetCategory === EXTRA_CATEGORIES.LOOK) {
            if (isInCategory(card, EXTRA_CATEGORIES.SCHEDULED)) {
                removeFromCategory(card, EXTRA_CATEGORIES.SCHEDULED);
            }
            if (isInCategory(card, EXTRA_CATEGORIES.THROWN)) {
                removeFromCategory(card, EXTRA_CATEGORIES.THROWN);
            }
        }
        else if (targetCategory === EXTRA_CATEGORIES.THROWN) {
            for (const cat of [EXTRA_CATEGORIES.LOOK, EXTRA_CATEGORIES.SCHEDULED, STOCK_CATEGORIES.BOOKMARK, STOCK_CATEGORIES.WATCH_LATER]) {
                if (isInCategory(card, cat)) {
                    removeFromCategory(card, cat);
                }
            }
        }
    }

    // Полное удаление из всех категорий
    function clearAllCategories(card) {
        if (!card || !card.id) return;

        for (const cat of Object.values(ALL_CATEGORIES)) {
            if (isInCategory(card, cat)) {
                removeFromCategory(card, cat);
            }
        }

        addToLog('clear_all', card, 'all', null);
        clearTimelinesForCard(card);
    }

    // Получение элементов категории с прогрессом
    function getCategoryItems(category, filters = {}) {
        let items = getCategoryItemsSafe(category);

        if (filters.type === 'movie') {
            items = items.filter(item => !item.original_name);
        } else if (filters.type === 'tv') {
            items = items.filter(item => item.original_name);
        }

        if (filters.sort === 'title') {
            items.sort((a, b) => (a.title || a.name || '').localeCompare(b.title || b.name || ''));
        } else if (filters.sort === 'year') {
            items.sort((a, b) => {
                const yearA = parseInt((a.release_date || a.first_air_date || '0000').slice(0, 4));
                const yearB = parseInt((b.release_date || b.first_air_date || '0000').slice(0, 4));
                return yearB - yearA;
            });
        }

        items.forEach(item => {
            item.favplus_primary = getPrimaryCategory(item);
        });

        return items;
    }

    // Формирование ключа таймкода
    function getTimelineKey(card, season = null, episode = null) {
        if (!card) return null;
        if (card.original_name && season !== null && episode !== null) {
            return `${card.id}_s${season}_e${episode}`;
        } else if (card.original_name) {
            return `${card.id}_series`;
        } else {
            return `${card.id}`;
        }
    }

    // Сохранение таймкода
    function saveTimeline(card, currentTime, duration, percent, season = null, episode = null) {
        if (!card || !card.id) return;

        const key = getTimelineKey(card, season, episode);
        if (!key) return;

        if (!data.customTimelines[key]) {
            data.customTimelines[key] = {};
        }

        data.customTimelines[key] = {
            time: currentTime,
            duration: duration,
            percent: percent,
            updated: Date.now(),
            season: season,
            episode: episode,
            cardId: card.id,
            cardTitle: card.title || card.name
        };

        saveData();
        checkAutoStatuses(card, percent, season, episode);
    }

    // Получение таймкода
    function getTimeline(card, season = null, episode = null) {
        if (!card || !card.id) return null;
        const key = getTimelineKey(card, season, episode);
        return data.customTimelines[key] || null;
    }

    // Получение прогресса для карточки
    function getProgressForCard(card) {
        if (!card || !card.id) return 0;

        if (card.original_name) {
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

    // Очистка таймкодов карточки
    function clearTimelinesForCard(card) {
        if (!card || !card.id) return;
        const prefix = `${card.id}`;
        for (const key in data.customTimelines) {
            if (key.startsWith(prefix)) {
                delete data.customTimelines[key];
            }
        }
        saveData();
    }

    // Авто-статусы для фильмов
    function checkMovieAutoStatus(card, percent) {
        if (!card || card.original_name) return;

        if (percent >= CONFIG.autoWatchThreshold && !isInCategory(card, EXTRA_CATEGORIES.VIEWED)) {
            if (!isInCategory(card, EXTRA_CATEGORIES.LOOK)) {
                addToCategory(card, EXTRA_CATEGORIES.LOOK);
                addToLog('auto_move', card, null, EXTRA_CATEGORIES.LOOK);
            }
        }

        if (percent >= CONFIG.autoViewedThreshold) {
            if (!isInCategory(card, EXTRA_CATEGORIES.VIEWED)) {
                addToCategory(card, EXTRA_CATEGORIES.VIEWED);
                addToLog('auto_move', card, null, EXTRA_CATEGORIES.VIEWED);
            }
        }
    }

    // Авто-статусы для сериалов
    function checkSeriesAutoStatus(card, percent) {
        if (!card || !card.original_name) return;

        if (percent >= CONFIG.autoWatchThreshold && !isInCategory(card, EXTRA_CATEGORIES.VIEWED)) {
            if (!isInCategory(card, EXTRA_CATEGORIES.LOOK)) {
                addToCategory(card, EXTRA_CATEGORIES.LOOK);
                addToLog('auto_move', card, null, EXTRA_CATEGORIES.LOOK);
            }
        }
    }

    function checkAutoStatuses(card, percent, season, episode) {
        if (!card) return;
        checkMovieAutoStatus(card, percent);
        checkSeriesAutoStatus(card, percent);
    }

    // Фоновые задачи
    function checkAutoThrown() {
        const cutoff = Date.now() - (CONFIG.autoThrownDays * 24 * 60 * 60 * 1000);
        const lookItems = getCategoryItemsSafe(EXTRA_CATEGORIES.LOOK);

        lookItems.forEach(card => {
            let lastUpdate = 0;
            const prefix = `${card.id}`;

            for (const key in data.customTimelines) {
                if (key.startsWith(prefix) && data.customTimelines[key].updated > lastUpdate) {
                    lastUpdate = data.customTimelines[key].updated;
                }
            }

            if (lastUpdate > 0 && lastUpdate < cutoff) {
                removeFromCategory(card, EXTRA_CATEGORIES.LOOK);
                addToCategory(card, EXTRA_CATEGORIES.THROWN);
                addToLog('auto_cleanup', card, EXTRA_CATEGORIES.LOOK, EXTRA_CATEGORIES.THROWN);
            }
        });
    }

    function cleanupOldTimelines() {
        const cutoff = Date.now() - (CONFIG.autoViewedCleanupDays * 24 * 60 * 60 * 1000);
        let deleted = 0;

        for (const key in data.customTimelines) {
            if (data.customTimelines[key].updated < cutoff) {
                delete data.customTimelines[key];
                deleted++;
            }
        }

        if (deleted > 0) {
            saveData();
        }
    }

    // Хранение данных
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
        try {
            Lampa.Storage.set(CONFIG.storagePrefix + 'data', toSave);
        } catch(e) {
            console.warn('[FavPlus] Error saving data:', e);
        }
    }

    function loadData() {
        try {
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
        } catch(e) {
            console.warn('[FavPlus] Error loading data:', e);
        }
    }

    // Gist синхронизация
    async function syncWithGist() {
        if (!data.gistId || !data.gistToken) return false;

        try {
            const syncData = {
                version: CONFIG.version,
                timestamp: Date.now(),
                categories: {},
                timelines: data.customTimelines,
                bookmarks: data.sectionBookmarks
            };

            for (const cat of Object.values(ALL_CATEGORIES)) {
                syncData.categories[cat] = getCategoryItemsSafe(cat);
            }

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

            let mergedData = syncData;
            if (existingContent && existingContent.timestamp > syncData.timestamp) {
                mergedData = existingContent;
            }

            const updateResponse = await fetch(gistUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${data.gistToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    files: { [filename]: { content: JSON.stringify(mergedData, null, 2) } }
                })
            });

            if (!updateResponse.ok) throw new Error(`HTTP ${updateResponse.status}`);

            for (const cat in mergedData.categories) {
                const currentIds = new Set(getCategoryItemsSafe(cat).map(i => i.id));
                for (const item of mergedData.categories[cat]) {
                    if (!currentIds.has(item.id)) {
                        const card = { id: item.id, title: item.title, name: item.title };
                        if (item.type === 'tv') card.original_name = item.title;
                        addToCategory(card, cat);
                    }
                }
            }

            data.lastSync = Date.now();
            saveData();
            return true;

        } catch (error) {
            console.error('[FavPlus] Sync failed:', error);
            return false;
        }
    }

    // Меню плагина
    function openFavPlusPanel() {
        const items = [];

        const displayCategories = [
            EXTRA_CATEGORIES.LOOK,
            EXTRA_CATEGORIES.VIEWED,
            EXTRA_CATEGORIES.SCHEDULED,
            EXTRA_CATEGORIES.THROWN,
            STOCK_CATEGORIES.BOOKMARK,
            STOCK_CATEGORIES.LIKE,
            STOCK_CATEGORIES.WATCH_LATER,
            EXTRA_CATEGORIES.COLLECTION
        ];

        for (const cat of displayCategories) {
            const count = getCategoryItemsSafe(cat).length;
            items.push({
                title: CATEGORY_NAMES[cat],
                subtitle: `${count} элементов`,
                category: cat,
                onSelect: () => openCategoryView(cat)
            });
        }

        items.push({ separator: true });
        items.push({ title: 'Продолжить просмотр', onSelect: () => continueWatching() });
        items.push({ title: 'Случайный фильм', onSelect: () => openRandomMovie() });
        items.push({ title: 'Статистика', onSelect: () => showStatistics() });
        items.push({ title: 'Настройки', onSelect: () => openSettings() });

        Lampa.Select.show({
            title: 'Избранное+',
            items: items,
            onBack: () => Lampa.Controller.toggle('menu')
        });
    }

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
            onBack: () => openFavPlusPanel()
        });
    }

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
            const card = { id: lastWatched.cardId, title: lastWatched.cardTitle };
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

    function openRandomMovie() {
        const lookItems = getCategoryItems(EXTRA_CATEGORIES.LOOK);
        const scheduledItems = getCategoryItems(EXTRA_CATEGORIES.SCHEDULED);
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

                if (tl.season) totalEpisodes++;
                else totalMovies++;

                topByTime.push({ title: tl.cardTitle, time: watchedTime, percent: tl.percent });
            }
        }

        topByTime.sort((a, b) => b.time - a.time);
        const top5 = topByTime.slice(0, 5);
        const hours = Math.floor(totalTime / 3600);
        const minutes = Math.floor((totalTime % 3600) / 60);

        let statsHtml = `<div style="padding: 1em; line-height: 1.8;">
            <div><strong>Общее время:</strong> ${hours}ч ${minutes}м</div>
            <div><strong>Фильмов просмотрено:</strong> ${totalMovies}</div>
            <div><strong>Серий просмотрено:</strong> ${totalEpisodes}</div>
            <div style="margin-top: 1em;"><strong>Топ-5 по времени:</strong></div>
            <div style="font-size: 0.9em;">`;

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
            onBack: () => Lampa.Modal.close()
        });
    }

    function openSettings() {
        const items = [
            { title: 'Авто-Смотрю', subtitle: `${CONFIG.autoWatchThreshold}%`, setting: 'autoWatchThreshold' },
            { title: 'Авто-Просмотрено', subtitle: `${CONFIG.autoViewedThreshold}%`, setting: 'autoViewedThreshold' },
            { title: 'Авто-Брошено (дней)', subtitle: `${CONFIG.autoThrownDays} дней`, setting: 'autoThrownDays' },
            { title: 'Очистка просмотренных (дней)', subtitle: `${CONFIG.autoViewedCleanupDays} дней`, setting: 'autoViewedCleanupDays' },
            { separator: true },
            { title: 'GitHub Token', subtitle: data.gistToken ? 'Установлен' : 'Не установлен', setting: 'gistToken' },
            { title: 'Gist ID', subtitle: data.gistId || 'Не указан', setting: 'gistId' },
            { title: 'Синхронизировать сейчас', onSelect: () => syncWithGist().then(s => Lampa.Noty.show(s ? 'Синхронизация выполнена' : 'Ошибка синхронизации')) }
        ];

        Lampa.Select.show({
            title: 'Настройки Избранное+',
            items: items,
            onSelect: (item) => {
                if (item.setting === 'gistToken') {
                    Lampa.Input.edit({ title: 'GitHub Token', value: data.gistToken || '', free: true }, (v) => {
                        if (v) data.gistToken = v; saveData(); openSettings();
                    });
                } else if (item.setting === 'gistId') {
                    Lampa.Input.edit({ title: 'Gist ID', value: data.gistId || '', free: true }, (v) => {
                        if (v) data.gistId = v; saveData(); openSettings();
                    });
                }
            },
            onBack: () => openFavPlusPanel()
        });
    }

    // Визуальные компоненты
    function addStatusToCard() {
        const originalCardCreate = Lampa.Card.prototype.create;
        if (!originalCardCreate) return;

        Lampa.Card.prototype.create = function() {
            originalCardCreate.call(this);
            const cardData = this.data;
            const primaryCategory = getPrimaryCategory(cardData);
            const progress = getProgressForCard(cardData);

            if (primaryCategory || progress > 0) {
                const posterElement = this.html.querySelector('.card__poster, .card__view');
                if (posterElement) {
                    const statusBlock = Lampa.Template.elem('div', { class: 'favplus-card-status' });
                    if (primaryCategory && CATEGORY_NAMES[primaryCategory]) {
                        const textSpan = Lampa.Template.elem('span', { class: 'favplus-status-text', text: CATEGORY_NAMES[primaryCategory] });
                        statusBlock.appendChild(textSpan);
                    }
                    if (cardData.original_name && progress > 0 && progress < 100) {
                        const progressSpan = Lampa.Template.elem('span', { class: 'favplus-status-progress', text: `${Math.round(progress)}%` });
                        statusBlock.appendChild(progressSpan);
                    }
                    posterElement.appendChild(statusBlock);
                }
            }
        };
    }

    // Инициализация
    function init() {
        console.log(`[FavPlus] Initializing v${CONFIG.version}`);

        initExtraCategories();
        loadData();
        addStatusToCard();

        Lampa.Favorite.clearAll = clearAllCategories;
        Lampa.Favorite.getPrimary = getPrimaryCategory;
        Lampa.Favorite.getWithProgress = getCategoryItems;
        Lampa.Timeline.saveExtended = saveTimeline;
        Lampa.Timeline.getExtended = getTimeline;

        Lampa.Menu.addButton(
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15 8H22L16 12L19 18L12 14L5 18L8 12L2 8H9L12 2Z" fill="currentColor"/></svg>',
            'Избранное+',
            () => openFavPlusPanel()
        );

        Lampa.Player.listener.follow('timeupdate', (data) => {
            const activity = Lampa.Activity.active();
            if (activity && activity.movie) {
                const card = activity.movie;
                const playData = Lampa.Player.playdata();
                saveTimeline(card, data.current || 0, data.duration || 0, data.percent || 0, playData?.season, playData?.episode);
            }
        });

        setInterval(() => { checkAutoThrown(); cleanupOldTimelines(); }, 60 * 60 * 1000);

        if (data.gistId && data.gistToken) setTimeout(() => syncWithGist(), 5000);
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', (e) => { if (e.type === 'ready') init(); });
})();
