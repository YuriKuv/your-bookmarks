// ============================================================
// plugins/extended_favorites/start.js
// ============================================================
(function() {
    if (window.extendedFavoritesLoaded) return;
    window.extendedFavoritesLoaded = true;

    const PLUGIN_NAME = 'Extended Favorites+';
    const PLUGIN_VERSION = '1.0.0';

    // ------------------------------------------------------------------------
    // 1. ЯДРО ПЛАГИНА: ХРАНИЛИЩЕ, СТАТУСЫ, ЛОГИ
    // ------------------------------------------------------------------------
    const STORAGE_KEYS = {
        STATUSES: 'ef_statuses',      // { item_id: ['favorite', 'watching'] }
        TIMELINE: 'ef_timeline',      // { hash: { percent, time, duration, updated_at } }
        TIMELINE_MAP: 'ef_timeline_map', // { lampa_hash: 's1_e2' }
        SECTIONS: 'ef_saved_sections',   // [{ name, url, component, params, page }]
        LOG: 'ef_log',                   // [{ action, item_id, from, to, timestamp }]
        SETTINGS: 'ef_settings',         // { ... }
        CACHE_TV: 'ef_cache_tv'          // { tmdb_id: { seasons, episodes, last_episode_air_date } }
    };

    const DEFAULT_SETTINGS = {
        // Автоматика
        auto_watching_enabled: true,
        auto_watched_enabled: true,
        auto_abandoned_enabled: true,
        watching_progress_percent: 5,
        watched_progress_percent: 95,
        abandoned_days: 30,
        auto_cleanup_viewed_days: 90,
        // Отображение
        show_status_on_poster: 'top', // 'top', 'center', 'bottom', 'off'
        hide_original_fav_button: true,
        // Gist синхронизация
        gist_token: '',
        gist_id: '',
        sync_interval_minutes: 60,
        sync_strategy: 'time', // 'time' or 'date'
        // Новые серии
        check_new_episodes_enabled: true,
        check_new_episodes_interval_hours: 6,
        new_episodes_notify: true
    };

    // Приоритет статусов (от высшего к низшему)
    const STATUS_PRIORITY = ['viewed', 'watching', 'planned', 'favorite', 'abandoned', 'collection'];
    // Человеческие названия
    const STATUS_NAMES = {
        favorite: '⭐ Избранное',
        watching: '👁️ Смотрю',
        planned: '📋 Буду смотреть',
        viewed: '✅ Просмотрено',
        abandoned: '❌ Брошено',
        collection: '📦 Коллекция'
    };
    const STATUS_ICONS = {
        favorite: '⭐',
        watching: '👁️',
        planned: '📋',
        viewed: '✅',
        abandoned: '❌',
        collection: '📦'
    };

    // Инициализация хранилища
    function initStorage() {
        if (!localStorage.getItem(STORAGE_KEYS.STATUSES)) {
            localStorage.setItem(STORAGE_KEYS.STATUSES, JSON.stringify({}));
        }
        if (!localStorage.getItem(STORAGE_KEYS.TIMELINE)) {
            localStorage.setItem(STORAGE_KEYS.TIMELINE, JSON.stringify({}));
        }
        if (!localStorage.getItem(STORAGE_KEYS.TIMELINE_MAP)) {
            localStorage.setItem(STORAGE_KEYS.TIMELINE_MAP, JSON.stringify({}));
        }
        if (!localStorage.getItem(STORAGE_KEYS.SECTIONS)) {
            localStorage.setItem(STORAGE_KEYS.SECTIONS, JSON.stringify([]));
        }
        if (!localStorage.getItem(STORAGE_KEYS.LOG)) {
            localStorage.setItem(STORAGE_KEYS.LOG, JSON.stringify([]));
        }
        if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
            localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
        }
        if (!localStorage.getItem(STORAGE_KEYS.CACHE_TV)) {
            localStorage.setItem(STORAGE_KEYS.CACHE_TV, JSON.stringify({}));
        }
    }

    function getSettings() {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS));
    }

    function saveSettings(settings) {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    }

    // Получить все статусы для элемента
    function getItemStatuses(itemId) {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEYS.STATUSES));
        return all[itemId] || [];
    }

    // Установить статус (добавить или удалить)
    function setItemStatus(itemId, status, add) {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEYS.STATUSES));
        if (!all[itemId]) all[itemId] = [];
        const index = all[itemId].indexOf(status);
        if (add && index === -1) {
            all[itemId].push(status);
        } else if (!add && index !== -1) {
            all[itemId].splice(index, 1);
        }
        if (all[itemId].length === 0) delete all[itemId];
        localStorage.setItem(STORAGE_KEYS.STATUSES, JSON.stringify(all));
    }

    // Получить первичный статус (самый приоритетный)
    function getPrimaryStatus(itemId) {
        const statuses = getItemStatuses(itemId);
        for (let priority of STATUS_PRIORITY) {
            if (statuses.includes(priority)) return priority;
        }
        return null;
    }

    // Проверка, находится ли элемент в какой-либо категории
    function isInAnyCategory(itemId, excludeCategories = []) {
        const statuses = getItemStatuses(itemId);
        return statuses.some(s => !excludeCategories.includes(s));
    }

    // Добавить запись в лог
    function logAction(action, itemId, fromStatus, toStatus, extra = {}) {
        const logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOG));
        logs.unshift({
            timestamp: Date.now(),
            action,
            itemId,
            fromStatus,
            toStatus,
            extra
        });
        // Ограничим 200 записями
        if (logs.length > 200) logs.pop();
        localStorage.setItem(STORAGE_KEYS.LOG, JSON.stringify(logs));
    }

    // ------------------------------------------------------------------------
    // 2. РАСШИРЕННЫЕ ТАЙМКОДЫ
    // ------------------------------------------------------------------------
    // Генерация ключа для таймкода
    function generateTimelineKey(card, playData) {
        if (card.original_name) { // сериал
            const season = playData.season || 1;
            const episode = playData.episode || 1;
            return `tmdb_${card.id}_s${season}_e${episode}`;
        } else { // фильм
            return `tmdb_${card.id}`;
        }
    }

    // Сохранить таймкод (вызывается из Lampa.Timeline.update)
    function saveTimelineExtended(hash, percent, time, duration, card, playData) {
        const extKey = generateTimelineKey(card, playData);
        const allTimeline = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE));
        const existing = allTimeline[extKey] || {};
        const now = Date.now();
        allTimeline[extKey] = {
            percent: Math.min(100, Math.max(0, percent)),
            time: time || 0,
            duration: duration || 0,
            updated_at: now,
            lampa_hash: hash
        };
        localStorage.setItem(STORAGE_KEYS.TIMELINE, JSON.stringify(allTimeline));

        // Сохраняем маппинг для обратной совместимости
        const map = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE_MAP));
        map[hash] = extKey;
        localStorage.setItem(STORAGE_KEYS.TIMELINE_MAP, JSON.stringify(map));

        // Триггерим авто-статусы
        if (getSettings().auto_watching_enabled || getSettings().auto_watched_enabled) {
            checkAutoStatus(card, playData, allTimeline[extKey]);
        }
        return extKey;
    }

    // Получить расширенный таймкод
    function getTimelineExtended(extKey) {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE));
        return all[extKey] || { percent: 0, time: 0, duration: 0 };
    }

    // Слияние с file_view (при старте плагина)
    function mergeWithFileView() {
        const fileView = JSON.parse(localStorage.getItem('file_view') || '{}');
        const extTimeline = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE));
        const map = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE_MAP));
        let changed = false;

        for (const [hash, data] of Object.entries(fileView)) {
            let extKey = map[hash];
            if (!extKey && data.card_id) {
                // Пытаемся восстановить по card_id
                extKey = `tmdb_${data.card_id}`;
                if (data.season && data.episode) extKey += `_s${data.season}_e${data.episode}`;
            }
            if (extKey && extTimeline[extKey]) {
                // Если есть в расширенном, сравниваем updated_at
                if (data.updated_at > extTimeline[extKey].updated_at) {
                    extTimeline[extKey] = {
                        percent: data.percent,
                        time: data.time,
                        duration: data.duration,
                        updated_at: data.updated_at,
                        lampa_hash: hash
                    };
                    changed = true;
                }
            } else if (extKey) {
                // Переносим из file_view
                extTimeline[extKey] = {
                    percent: data.percent,
                    time: data.time,
                    duration: data.duration,
                    updated_at: data.updated_at || Date.now(),
                    lampa_hash: hash
                };
                map[hash] = extKey;
                changed = true;
            }
        }
        if (changed) {
            localStorage.setItem(STORAGE_KEYS.TIMELINE, JSON.stringify(extTimeline));
            localStorage.setItem(STORAGE_KEYS.TIMELINE_MAP, JSON.stringify(map));
        }
    }

    // ------------------------------------------------------------------------
    // 3. АВТОМАТИЧЕСКИЕ СТАТУСЫ
    // ------------------------------------------------------------------------
    // Получить кеш информации о сериале из TMDB
    async function getTvCache(tmdbId) {
        const cache = JSON.parse(localStorage.getItem(STORAGE_KEYS.CACHE_TV));
        const now = Date.now();
        if (cache[tmdbId] && cache[tmdbId].updated_at > now - 86400000) {
            return cache[tmdbId];
        }
        // Запрос к TMDB
        return new Promise((resolve) => {
            Lampa.TMDB.get(`tv/${tmdbId}`, {}, (data) => {
                const seasons = data.seasons || [];
                let totalEpisodes = 0;
                let lastEpisodeAirDate = null;
                for (const s of seasons) {
                    if (s.episode_count) totalEpisodes += s.episode_count;
                    if (s.air_date && (!lastEpisodeAirDate || s.air_date > lastEpisodeAirDate)) {
                        lastEpisodeAirDate = s.air_date;
                    }
                }
                const info = {
                    seasons: seasons.length,
                    total_episodes: totalEpisodes,
                    last_episode_air_date: lastEpisodeAirDate,
                    updated_at: Date.now()
                };
                cache[tmdbId] = info;
                localStorage.setItem(STORAGE_KEYS.CACHE_TV, JSON.stringify(cache));
                resolve(info);
            }, () => resolve(null));
        });
    }

    async function checkAutoStatus(card, playData, timelineData) {
        const settings = getSettings();
        const itemId = card.id;
        const currentStatus = getPrimaryStatus(itemId);
        const progress = timelineData.percent;

        // Не трогаем уже просмотренные или брошенные
        if (currentStatus === 'viewed' || currentStatus === 'abandoned') return;

        if (card.original_name) {
            // СЕРИАЛ
            if (settings.auto_watching_enabled && currentStatus !== 'watching' && progress >= settings.watching_progress_percent) {
                setItemStatus(itemId, 'watching', true);
                logAction('auto_watching', itemId, currentStatus, 'watching', { progress, card_title: card.title });
                // Удаляем из planned, если был
                if (getItemStatuses(itemId).includes('planned')) {
                    setItemStatus(itemId, 'planned', false);
                }
            }
            // Проверка на завершение сериала
            if (settings.auto_watched_enabled && currentStatus !== 'viewed') {
                const tvInfo = await getTvCache(card.id);
                if (tvInfo && tvInfo.total_episodes > 0) {
                    // Определяем последний просмотренный эпизод
                    const lastKey = `tmdb_${card.id}_s${playData.season || 1}_e${playData.episode || 1}`;
                    const lastTimeline = getTimelineExtended(lastKey);
                    const isLastEpisode = (playData.season === tvInfo.seasons) && (playData.episode === tvInfo.total_episodes);
                    if (isLastEpisode && lastTimeline.percent >= settings.watched_progress_percent) {
                        setItemStatus(itemId, 'viewed', true);
                        // Удаляем из других категорий
                        setItemStatus(itemId, 'watching', false);
                        setItemStatus(itemId, 'planned', false);
                        logAction('auto_viewed', itemId, currentStatus, 'viewed', { card_title: card.title });
                    }
                }
            }
        } else {
            // ФИЛЬМ
            if (settings.auto_watching_enabled && currentStatus !== 'watching' && progress >= settings.watching_progress_percent) {
                setItemStatus(itemId, 'watching', true);
                logAction('auto_watching', itemId, currentStatus, 'watching', { progress, card_title: card.title });
            }
            if (settings.auto_watched_enabled && currentStatus !== 'viewed' && progress >= settings.watched_progress_percent) {
                setItemStatus(itemId, 'viewed', true);
                setItemStatus(itemId, 'watching', false);
                setItemStatus(itemId, 'planned', false);
                logAction('auto_viewed', itemId, currentStatus, 'viewed', { progress, card_title: card.title });
            }
        }
    }

    // Авто-брошено (запускается по таймеру раз в день)
    function checkAbandoned() {
        const settings = getSettings();
        if (!settings.auto_abandoned_enabled) return;
        const allTimeline = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE));
        const now = Date.now();
        const abandonLimit = settings.abandoned_days * 86400000;

        for (const [extKey, data] of Object.entries(allTimeline)) {
            if (data.updated_at && (now - data.updated_at) > abandonLimit) {
                // Извлекаем itemId из ключа tmdb_12345 или tmdb_12345_s1_e2
                const match = extKey.match(/tmdb_(\d+)/);
                if (match) {
                    const itemId = parseInt(match[1]);
                    const statuses = getItemStatuses(itemId);
                    if (statuses.includes('watching') && !statuses.includes('viewed')) {
                        setItemStatus(itemId, 'abandoned', true);
                        setItemStatus(itemId, 'watching', false);
                        logAction('auto_abandoned', itemId, 'watching', 'abandoned', { days: Math.floor((now - data.updated_at) / 86400000) });
                    }
                }
            }
        }
    }

    // Очистка просмотренных таймкодов (запускается раз в неделю)
    function cleanupViewedTimelines() {
        const settings = getSettings();
        const allTimeline = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE));
        const now = Date.now();
        const limit = settings.auto_cleanup_viewed_days * 86400000;
        let changed = false;

        for (const [extKey, data] of Object.entries(allTimeline)) {
            const match = extKey.match(/tmdb_(\d+)/);
            if (match) {
                const itemId = parseInt(match[1]);
                const statuses = getItemStatuses(itemId);
                if (statuses.includes('viewed') && data.updated_at && (now - data.updated_at) > limit) {
                    delete allTimeline[extKey];
                    changed = true;
                }
            }
        }
        if (changed) {
            localStorage.setItem(STORAGE_KEYS.TIMELINE, JSON.stringify(allTimeline));
        }
    }

    // ------------------------------------------------------------------------
    // 4. КАСТОМНОЕ МЕНЮ ВЫБОРА СТАТУСА (вместо стандартного избранного)
    // ------------------------------------------------------------------------
    function showStatusMenu(card) {
        const itemId = card.id;
        const currentStatuses = getItemStatuses(itemId);
        const items = [];

        for (const [status, name] of Object.entries(STATUS_NAMES)) {
            const isActive = currentStatuses.includes(status);
            items.push({
                title: name,
                checkbox: true,
                checked: isActive,
                status: status,
                onCheck: (item, isChecked) => {
                    setItemStatus(itemId, status, isChecked);
                    logAction(isChecked ? 'add' : 'remove', itemId, null, status, { card_title: card.title });
                    // Обновляем интерфейс
                    updateCardStatus(card);
                    updateFullPageStatus(card);
                }
            });
        }

        // Кнопка "Удалить из всех"
        items.push({ title: '🗑️ Удалить из всех списков', separator: true });
        items.push({
            title: 'Удалить полностью (включая таймкоды)',
            onSelect: () => {
                // Удаляем из всех статусов
                for (const s of Object.keys(STATUS_NAMES)) {
                    setItemStatus(itemId, s, false);
                }
                // Удаляем таймкоды
                const allTimeline = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE));
                for (const key of Object.keys(allTimeline)) {
                    if (key.includes(`tmdb_${itemId}`)) delete allTimeline[key];
                }
                localStorage.setItem(STORAGE_KEYS.TIMELINE, JSON.stringify(allTimeline));
                logAction('full_remove', itemId, null, null, { card_title: card.title });
                updateCardStatus(card);
                updateFullPageStatus(card);
                Lampa.Noty.show(`"${card.title}" полностью удалён из всех списков`);
            }
        });

        Lampa.Select.show({
            title: 'Выберите списки',
            items: items,
            onBack: () => Lampa.Controller.toggle('content')
        });
    }

    // ------------------------------------------------------------------------
    // 5. ВИЗУАЛЬНОЕ ОТОБРАЖЕНИЕ НА КАРТОЧКАХ (постеры)
    // ------------------------------------------------------------------------
    function updateCardStatus(card) {
        // Находим все карточки с этим ID
        const cards = document.querySelectorAll(`.card[data-id="${card.id}"]`);
        cards.forEach(cardEl => {
            const status = getPrimaryStatus(card.id);
            const settings = getSettings();
            if (settings.show_status_on_poster === 'off' || !status) {
                // Удаляем наш блок, если он был
                const existing = cardEl.querySelector('.ef-status-badge');
                if (existing) existing.remove();
                return;
            }

            let badge = cardEl.querySelector('.ef-status-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.className = `ef-status-badge ef-status-${settings.show_status_on_poster}`;
                cardEl.querySelector('.card__view').appendChild(badge);
            }

            const timeline = getTimelineExtendedByCard(card);
            const progress = timeline.percent || 0;
            const statusText = STATUS_ICONS[status] || '';

            let extraText = '';
            if (status === 'watching' && progress > 0) {
                extraText = ` ${progress}%`;
            } else if (status === 'viewed') {
                extraText = ' ✓';
            }

            badge.innerHTML = `${statusText} ${STATUS_NAMES[status] || ''}${extraText}`;
            badge.style.display = 'flex';
        });
    }

    function getTimelineExtendedByCard(card) {
        // Для простоты — первый попавшийся таймкод
        const allTimeline = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE));
        for (const [key, data] of Object.entries(allTimeline)) {
            if (key.includes(`tmdb_${card.id}`)) return data;
        }
        return { percent: 0 };
    }

    // Хук на отрисовку карточек
    function hookCardRender() {
        Lampa.Listener.follow('card', (event) => {
            if (event.type === 'build') {
                const card = event.data;
                if (card && card.id) {
                    // Добавляем data-id для поиска
                    event.element.setAttribute('data-id', card.id);
                    setTimeout(() => updateCardStatus(card), 50);
                }
            }
        });
    }

    // ------------------------------------------------------------------------
    // 6. ВИЗУАЛЬНОЕ ОТОБРАЖЕНИЕ НА СТРАНИЦЕ ФИЛЬМА (full)
    // ------------------------------------------------------------------------
    function updateFullPageStatus(card) {
        const fullPage = document.querySelector('.full-start-new');
        if (!fullPage) return;
        const status = getPrimaryStatus(card.id);
        let statusBlock = fullPage.querySelector('.ef-full-status');
        if (!statusBlock) {
            statusBlock = document.createElement('div');
            statusBlock.className = 'ef-full-status';
            const buttonsRow = fullPage.querySelector('.full-start-new__buttons');
            if (buttonsRow) buttonsRow.parentNode.insertBefore(statusBlock, buttonsRow);
        }
        if (status) {
            statusBlock.innerHTML = `${STATUS_ICONS[status]} ${STATUS_NAMES[status]}`;
            statusBlock.style.display = 'block';
        } else {
            statusBlock.style.display = 'none';
        }
    }

    function replaceFavButtonOnFullPage() {
        Lampa.Listener.follow('full', (event) => {
            if (event.type === 'complite') {
                const card = event.data.movie;
                const settings = getSettings();
                // Скрываем стандартную кнопку, если нужно
                if (settings.hide_original_fav_button) {
                    const origBtn = document.querySelector('.full-start-new .button--book');
                    if (origBtn) origBtn.style.display = 'none';
                }
                // Добавляем свою кнопку
                const buttonsRow = document.querySelector('.full-start-new__buttons');
                if (buttonsRow && !document.querySelector('.ef-fav-button')) {
                    const btn = document.createElement('div');
                    btn.className = 'full-start__button selector ef-fav-button';
                    btn.innerHTML = `<svg width="21" height="32" viewBox="0 0 21 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 1.5H19C19.2761 1.5 19.5 1.72386 19.5 2V27.9618C19.5 28.3756 19.0261 28.6103 18.697 28.3595L12.6212 23.7303C11.3682 22.7757 9.63183 22.7757 8.37885 23.7303L2.30302 28.3595C1.9739 28.6103 1.5 28.3756 1.5 27.9618V2C1.5 1.72386 1.72386 1.5 2 1.5Z" stroke="currentColor" stroke-width="2.5"></path>
                    </svg><span>В списки</span>`;
                    btn.onclick = () => showStatusMenu(card);
                    buttonsRow.appendChild(btn);
                }
                updateFullPageStatus(card);
            }
        });
    }

    // ------------------------------------------------------------------------
    // 7. ЗАКЛАДКИ РАЗДЕЛОВ
    // ------------------------------------------------------------------------
    function saveCurrentSection() {
        const active = Lampa.Activity.active();
        if (!active) return;
        const name = prompt('Название раздела:', active.title || 'Новый раздел');
        if (!name) return;
        const sections = JSON.parse(localStorage.getItem(STORAGE_KEYS.SECTIONS));
        sections.push({
            name: name,
            url: active.url,
            component: active.component,
            params: active.params || {},
            page: active.page || 1,
            timestamp: Date.now()
        });
        localStorage.setItem(STORAGE_KEYS.SECTIONS, JSON.stringify(sections));
        Lampa.Noty.show(`Раздел "${name}" сохранён`);
        updateSectionsMenu();
    }

    function deleteSection(index) {
        const sections = JSON.parse(localStorage.getItem(STORAGE_KEYS.SECTIONS));
        const name = sections[index].name;
        sections.splice(index, 1);
        localStorage.setItem(STORAGE_KEYS.SECTIONS, JSON.stringify(sections));
        Lampa.Noty.show(`Раздел "${name}" удалён`);
        updateSectionsMenu();
    }

    function updateSectionsMenu() {
        const sections = JSON.parse(localStorage.getItem(STORAGE_KEYS.SECTIONS));
        let menuItem = document.querySelector('.menu__item[data-action="saved_sections"]');
        if (menuItem) menuItem.remove();

        if (sections.length === 0) return;

        const menuList = document.querySelector('.menu__list:first-child');
        if (!menuList) return;

        const li = document.createElement('li');
        li.className = 'menu__item selector';
        li.setAttribute('data-action', 'saved_sections');
        li.innerHTML = `<div class="menu__ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h16v16H4V4z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 8h8v8H8V8z" fill="currentColor"/></svg></div>
                        <div class="menu__text">📑 Закладки</div>`;
        li.onclick = () => {
            const items = sections.map((s, idx) => ({
                title: s.name,
                onSelect: () => {
                    Lampa.Activity.push({
                        url: s.url,
                        component: s.component,
                        params: s.params,
                        page: s.page
                    });
                },
                onLong: () => {
                    Lampa.Select.show({
                        title: s.name,
                        items: [{ title: 'Удалить', onSelect: () => deleteSection(idx) }],
                        onBack: () => Lampa.Controller.toggle('content')
                    });
                }
            }));
            Lampa.Select.show({ title: 'Сохранённые разделы', items, onBack: () => Lampa.Controller.toggle('content') });
        };
        menuList.appendChild(li);
    }

    // ------------------------------------------------------------------------
    // 8. GIST СИНХРОНИЗАЦИЯ (упрощённая, без Gist API)
    // ------------------------------------------------------------------------
    // Для Gist потребуется полноценная работа с GitHub API.
    // Здесь я оставлю заглушку, которую вы сможете доработать под свои нужды.
    function syncWithGist() {
        // Требуется реализация через fetch + GitHub API
        // Пример: https://api.github.com/gists/YOUR_GIST_ID
        console.log('[EF] Gist sync placeholder');
    }

    // ------------------------------------------------------------------------
    // 9. ОТСЛЕЖИВАНИЕ НОВЫХ СЕРИЙ
    // ------------------------------------------------------------------------
    async function checkNewEpisodes() {
        const settings = getSettings();
        if (!settings.check_new_episodes_enabled) return;

        const allStatuses = JSON.parse(localStorage.getItem(STORAGE_KEYS.STATUSES));
        const watchingIds = [];
        for (const [itemId, statuses] of Object.entries(allStatuses)) {
            if (statuses.includes('watching') || statuses.includes('planned')) {
                watchingIds.push(parseInt(itemId));
            }
        }

        for (const id of watchingIds) {
            const tvInfo = await getTvCache(id);
            if (!tvInfo) continue;
            // Проверяем, есть ли новые серии (по сравнению с последним просмотренным)
            // Для простоты — сравниваем с сохранённым last_episode_air_date
            const lastViewedKey = Object.keys(JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE))).find(k => k.includes(`tmdb_${id}_s`));
            let lastViewedSeason = 1, lastViewedEpisode = 1;
            if (lastViewedKey) {
                const match = lastViewedKey.match(/s(\d+)_e(\d+)/);
                if (match) {
                    lastViewedSeason = parseInt(match[1]);
                    lastViewedEpisode = parseInt(match[2]);
                }
            }
            // Если последний известный эпизод меньше общего числа — есть новые
            if (lastViewedSeason < tvInfo.seasons || (lastViewedSeason === tvInfo.seasons && lastViewedEpisode < tvInfo.total_episodes)) {
                // Показываем уведомление (через Lampa.Notice)
                Lampa.Notice.add({
                    title: `Новые серии: ${tvInfo.title || `ID ${id}`}`,
                    text: `Доступны новые эпизоды!`,
                    time: Date.now()
                });
            }
        }
    }

    // Запуск периодической проверки
    function startNewEpisodesChecker() {
        const settings = getSettings();
        if (!settings.check_new_episodes_enabled) return;
        const intervalMs = settings.check_new_episodes_interval_hours * 3600000;
        checkNewEpisodes();
        setInterval(checkNewEpisodes, intervalMs);
    }

    // ------------------------------------------------------------------------
    // 10. ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ "Избранное+"
    // ------------------------------------------------------------------------
    function addMenuItems() {
        // Пункт "Сохранить раздел"
        Lampa.Menu.addButton('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h16v16H4V4z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 8h8v8H8V8z" fill="currentColor"/></svg>', 'Сохранить раздел', saveCurrentSection);

        // Пункт "Избранное+"
        Lampa.Menu.addButton('⭐', 'Избранное+', () => {
            const items = [
                { title: '📋 Мои списки', onSelect: () => showStatusListsMenu() },
                { title: '▶️ Продолжить просмотр', onSelect: () => continueWatching() },
                { title: '🎲 Случайный фильм', onSelect: () => randomMovie() },
                { title: '🔍 Поиск по избранному', onSelect: () => searchInFavorites() },
                { title: '📊 Статистика', onSelect: () => showStats() },
                { title: '📜 История просмотров', onSelect: () => showHistory() },
                { title: '⚙️ Настройки', onSelect: () => Lampa.Settings.create('extended_favorites') }
            ];
            Lampa.Select.show({ title: 'Избранное+', items, onBack: () => Lampa.Controller.toggle('content') });
        });
    }

    function showStatusListsMenu() {
        const items = Object.entries(STATUS_NAMES).map(([status, name]) => ({
            title: name,
            onSelect: () => openStatusList(status)
        }));
        Lampa.Select.show({ title: 'Мои списки', items, onBack: () => Lampa.Controller.toggle('content') });
    }

    function openStatusList(status) {
        const allStatuses = JSON.parse(localStorage.getItem(STORAGE_KEYS.STATUSES));
        const itemIds = Object.keys(allStatuses).filter(id => allStatuses[id].includes(status));
        // Загружаем карточки по ID (упрощённо — через TMDB поиск)
        // Для полной реализации нужен массовый запрос к TMDB
        Lampa.Noty.show(`Список "${STATUS_NAMES[status]}" содержит ${itemIds.length} элементов`);
    }

    function continueWatching() {
        const allTimeline = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE));
        let best = null;
        for (const [key, data] of Object.entries(allTimeline)) {
            if (data.percent > 0 && data.percent < 95) {
                if (!best || data.updated_at > best.updated_at) best = { key, ...data };
            }
        }
        if (best && best.lampa_hash) {
            // Восстановить карточку и запустить плеер — сложно без полного контекста
            Lampa.Noty.show('Продолжение просмотра пока не реализовано');
        } else {
            Lampa.Noty.show('Нет незавершённых просмотров');
        }
    }

    function randomMovie() {
        const allStatuses = JSON.parse(localStorage.getItem(STORAGE_KEYS.STATUSES));
        const ids = Object.keys(allStatuses).filter(id => allStatuses[id].includes('favorite') || allStatuses[id].includes('planned'));
        if (ids.length === 0) {
            Lampa.Noty.show('Нет фильмов в избранном или планах');
            return;
        }
        const randomId = ids[Math.floor(Math.random() * ids.length)];
        Lampa.Activity.push({ component: 'full', id: parseInt(randomId), method: 'movie' });
    }

    function searchInFavorites() {
        Lampa.Input.edit({ title: 'Поиск по избранному', free: true, nosave: true }, (query) => {
            if (!query) return;
            // Поиск по TMDB с фильтром по ID из избранного
            Lampa.Noty.show(`Поиск: ${query} (демо)`);
        });
    }

    function showStats() {
        const allTimeline = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMELINE));
        let totalTime = 0;
        for (const data of Object.entries(allTimeline)) {
            totalTime += (data[1].time || 0);
        }
        const hours = Math.floor(totalTime / 3600);
        const minutes = Math.floor((totalTime % 3600) / 60);
        Lampa.Noty.show(`Общее время просмотра: ${hours}ч ${minutes}м`);
    }

    function showHistory() {
        const logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOG));
        const items = logs.slice(0, 20).map(log => ({
            title: new Date(log.timestamp).toLocaleString(),
            subtitle: `${log.action}: ${log.itemId} (${log.fromStatus || ''} → ${log.toStatus || ''})`
        }));
        Lampa.Select.show({ title: 'История действий', items, onBack: () => Lampa.Controller.toggle('content') });
    }

    // ------------------------------------------------------------------------
    // 11. НАСТРОЙКИ ПЛАГИНА
    // ------------------------------------------------------------------------
    function registerSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'extended_favorites',
            icon: '⭐',
            name: 'Избранное+',
            onBuild: (html) => {
                const settings = getSettings();
                const container = document.createElement('div');
                container.innerHTML = `
                    <div class="settings-param-title"><span>Автоматика</span></div>
                    <label><input type="checkbox" id="auto_watching_enabled" ${settings.auto_watching_enabled ? 'checked' : ''}> Авто-«Смотрю»</label><br>
                    <label><input type="checkbox" id="auto_watched_enabled" ${settings.auto_watched_enabled ? 'checked' : ''}> Авто-«Просмотрено»</label><br>
                    <label><input type="checkbox" id="auto_abandoned_enabled" ${settings.auto_abandoned_enabled ? 'checked' : ''}> Авто-«Брошено»</label><br>
                    <div class="settings-param-title"><span>Отображение</span></div>
                    <label><input type="checkbox" id="hide_original_fav_button" ${settings.hide_original_fav_button ? 'checked' : ''}> Скрыть стандартную кнопку</label><br>
                    <div class="settings-param-title"><span>Синхронизация Gist</span></div>
                    <label>Токен: <input type="text" id="gist_token" value="${settings.gist_token}" style="width:100%"></label><br>
                    <label>Gist ID: <input type="text" id="gist_id" value="${settings.gist_id}" style="width:100%"></label><br>
                    <button id="syncNowBtn">Синхронизировать сейчас</button>
                `;
                html.appendChild(container);

                container.querySelector('#auto_watching_enabled').onchange = (e) => { settings.auto_watching_enabled = e.target.checked; saveSettings(settings); };
                container.querySelector('#auto_watched_enabled').onchange = (e) => { settings.auto_watched_enabled = e.target.checked; saveSettings(settings); };
                container.querySelector('#auto_abandoned_enabled').onchange = (e) => { settings.auto_abandoned_enabled = e.target.checked; saveSettings(settings); };
                container.querySelector('#hide_original_fav_button').onchange = (e) => { settings.hide_original_fav_button = e.target.checked; saveSettings(settings); };
                container.querySelector('#gist_token').onchange = (e) => { settings.gist_token = e.target.value; saveSettings(settings); };
                container.querySelector('#gist_id').onchange = (e) => { settings.gist_id = e.target.value; saveSettings(settings); };
                container.querySelector('#syncNowBtn').onclick = () => syncWithGist();
            }
        });
    }

    // ------------------------------------------------------------------------
    // 12. ПЕРЕХВАТ Lampa.Favorite И Lampa.Timeline (ХУКИ)
    // ------------------------------------------------------------------------
    function hookFavoriteToggle() {
        // Сохраняем оригинальный метод для совместимости, но своё меню показываем через попап на карточках
        Lampa.Listener.follow('card', (event) => {
            if (event.type === 'build') {
                const favBtn = event.element.querySelector('.card__icons .card__icon--book');
                if (favBtn && getSettings().hide_original_fav_button) {
                    favBtn.style.display = 'none';
                }
                // Добавляем свою кнопку на карточку
                const iconsRow = event.element.querySelector('.card__icons');
                if (iconsRow && !event.element.querySelector('.ef-card-fav')) {
                    const myBtn = document.createElement('div');
                    myBtn.className = 'card__icon ef-card-fav selector';
                    myBtn.innerHTML = '⭐';
                    myBtn.onclick = (e) => {
                        e.stopPropagation();
                        showStatusMenu(event.data);
                    };
                    iconsRow.appendChild(myBtn);
                }
            }
        });
    }

    function hookTimelineUpdate() {
        Lampa.Listener.follow('timeline', (event) => {
            if (event.type === 'update') {
                const data = event.data;
                if (data && data.hash) {
                    // Пытаемся получить карточку из текущей активности
                    const activeCard = Lampa.Activity.active()?.card;
                    if (activeCard) {
                        saveTimelineExtended(data.hash, data.percent, data.time, data.duration, activeCard, { season: data.season, episode: data.episode });
                    }
                }
            }
        });
    }

    // ------------------------------------------------------------------------
    // 13. ЗАПУСК ПЛАГИНА
    // ------------------------------------------------------------------------
    function start() {
        initStorage();
        mergeWithFileView();
        hookCardRender();
        replaceFavButtonOnFullPage();
        hookFavoriteToggle();
        hookTimelineUpdate();
        addMenuItems();
        registerSettings();
        updateSectionsMenu();

        // Запуск периодических задач
        setInterval(checkAbandoned, 86400000); // раз в день
        setInterval(cleanupViewedTimelines, 604800000); // раз в неделю
        startNewEpisodesChecker();

        console.log(`[${PLUGIN_NAME}] v${PLUGIN_VERSION} загружен`);
    }

    // Ждём готовности Lampa
    if (window.appready) {
        start();
    } else {
        Lampa.Listener.follow('app', (e) => { if (e.type === 'ready') start(); });
    }
})();
