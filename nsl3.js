// plugins/smart_collections_plus.js
(function(){
    // Проверка готовности Lampa
    if(typeof Lampa === 'undefined') {
        document.addEventListener('lampa:ready', init);
        return;
    }
    init();

    function init() {
        // ==================== 1. РАСШИРЕННОЕ ХРАНИЛИЩЕ ====================
        const Core = {
            storageKey: 'smart_collections_plus',
            categories: ['fav', 'watching', 'planned', 'watched', 'dropped', 'collection'],
            priority: ['watching', 'planned', 'fav', 'watched', 'dropped', 'collection'],
            
            data: null,
            logs: [],
            
            load() {
                const saved = Lampa.Storage.get(this.storageKey, null);
                if(saved && saved.data) {
                    this.data = saved.data;
                    this.logs = saved.logs || [];
                } else {
                    this.reset();
                }
            },
            
            reset() {
                this.data = {};
                this.categories.forEach(cat => this.data[cat] = []);
                this.logs = [];
                this.save();
            },
            
            save() {
                Lampa.Storage.set(this.storageKey, { data: this.data, logs: this.logs });
                Lampa.Listener.send('smart_collections:update', { type: 'save' });
            },
            
            add(category, item) {
                if(!this.data[category] || this.data[category].find(i => i.id === item.id)) return false;
                
                // Авто-правила: перемещение между категориями
                if(category === 'watched') {
                    this.remove('watching', item);
                    this.remove('planned', item);
                    this.remove('fav', item);
                } else if(category === 'watching') {
                    this.remove('planned', item);
                } else if(category === 'dropped') {
                    this.categories.forEach(cat => {
                        if(cat !== 'collection') this.remove(cat, item);
                    });
                    this.add('collection', item);
                    return true;
                }
                
                this.data[category].push({ id: item.id, title: item.title || item.name, added: Date.now() });
                this.log({ action: 'add', category, item: item.id, time: Date.now() });
                this.save();
                return true;
            },
            
            remove(category, item) {
                if(!this.data[category]) return false;
                const index = this.data[category].findIndex(i => i.id === item.id);
                if(index === -1) return false;
                this.data[category].splice(index, 1);
                this.log({ action: 'remove', category, item: item.id, time: Date.now() });
                this.save();
                return true;
            },
            
            toggle(category, item) {
                if(this.is(category, item)) this.remove(category, item);
                else this.add(category, item);
            },
            
            is(category, item) {
                return this.data[category] && this.data[category].some(i => i.id === item.id);
            },
            
            getStatus(item) {
                for(const cat of this.priority) {
                    if(this.is(cat, item)) return cat;
                }
                return null;
            },
            
            getMainCategory(item) {
                const status = this.getStatus(item);
                if(status === 'fav') return '⭐ Избранное';
                if(status === 'watching') return '👁️ Смотрю';
                if(status === 'planned') return '📋 Буду смотреть';
                if(status === 'watched') return '✅ Просмотрено';
                if(status === 'dropped') return '❌ Брошено';
                if(status === 'collection') return '📦 Коллекция';
                return null;
            },
            
            log(entry) {
                this.logs.unshift(entry);
                if(this.logs.length > 500) this.logs = this.logs.slice(0, 500);
            },
            
            getLogs(limit = 100) {
                return this.logs.slice(0, limit);
            },
            
            clearAll(item) {
                this.categories.forEach(cat => this.remove(cat, item));
                // Очистка таймкодов
                TimeKeeper.clearAll(item.id);
            }
        };
        
        // ==================== 2. ПРОДВИНУТЫЕ ТАЙМКОДЫ ====================
        const TimeKeeper = {
            storageKey: 'smart_timestamps',
            data: {},
            
            load() {
                this.data = Lampa.Storage.get(this.storageKey, {});
                this.syncWithFileView();
            },
            
            save() {
                Lampa.Storage.set(this.storageKey, this.data);
            },
            
            makeKey(id, type, season, episode) {
                if(type === 'tv') return `${id}_s${season}_e${episode}`;
                return `${id}_movie`;
            },
            
            set(id, type, progress, duration, season = null, episode = null) {
                const key = this.makeKey(id, type, season, episode);
                const percent = Math.round((progress / duration) * 100);
                
                this.data[key] = {
                    id, type, progress, duration, percent,
                    season, episode,
                    updated: Date.now()
                };
                this.save();
                
                // Запуск автоматических правил
                AutoRules.check(id, type, percent, season, episode);
                
                Lampa.Listener.send('smart_collections:timestamp', { id, type, percent, season, episode });
            },
            
            get(id, type, season = null, episode = null) {
                const key = this.makeKey(id, type, season, episode);
                return this.data[key] || null;
            },
            
            getLastForMovie(id) {
                const key = `${id}_movie`;
                return this.data[key] || null;
            },
            
            getLastForTv(id) {
                const keys = Object.keys(this.data).filter(k => k.startsWith(`${id}_s`));
                if(!keys.length) return null;
                
                let last = null;
                for(const key of keys) {
                    const ts = this.data[key];
                    if(!last || ts.updated > last.updated) last = ts;
                }
                return last;
            },
            
            syncWithFileView() {
                const fileView = Lampa.Storage.get('file_view', {});
                for(const key in fileView) {
                    if(fileView[key] && fileView[key].time && !this.data[key]) {
                        const parts = key.split('_');
                        const id = parseInt(parts[0]);
                        const type = parts[1] === 'movie' ? 'movie' : 'tv';
                        let season = null, episode = null;
                        if(type === 'tv' && parts[2]) {
                            season = parseInt(parts[2].substring(1));
                            episode = parseInt(parts[3].substring(1));
                        }
                        this.data[key] = {
                            id, type,
                            progress: fileView[key].time,
                            duration: fileView[key].duration || 0,
                            percent: (fileView[key].time / (fileView[key].duration || 1)) * 100,
                            season, episode,
                            updated: fileView[key].updated || Date.now()
                        };
                    }
                }
                this.save();
            },
            
            clearAll(id) {
                const keys = Object.keys(this.data).filter(k => k.startsWith(`${id}_`));
                for(const key of keys) delete this.data[key];
                this.save();
            },
            
            getStatistics() {
                let totalTime = 0;
                let moviesCount = 0;
                let episodesCount = 0;
                const byCategory = { fav: 0, watching: 0, planned: 0, watched: 0, dropped: 0, collection: 0 };
                
                for(const key in this.data) {
                    const ts = this.data[key];
                    if(ts.type === 'movie') {
                        moviesCount++;
                        totalTime += ts.progress;
                    } else if(ts.type === 'tv') {
                        episodesCount++;
                        totalTime += ts.progress;
                    }
                }
                
                for(const cat of Core.categories) {
                    for(const item of Core.data[cat]) {
                        const ts = this.getLastForMovie(item.id);
                        if(ts) byCategory[cat] += ts.progress;
                    }
                }
                
                return { totalTime, moviesCount, episodesCount, byCategory };
            }
        };
        
        // ==================== 3. АВТОМАТИЧЕСКИЕ СТАТУСЫ ====================
        const AutoRules = {
            enabled: {
                autoWatching: true,
                autoWatched: true,
                autoDropped: true,
                autoCleanup: true
            },
            thresholds: {
                watchingPercent: 5,
                watchedPercent: 95,
                droppedDays: 30,
                cleanupDays: 90
            },
            
            check(id, type, percent, season, episode) {
                const item = { id, title: id };
                
                if(type === 'movie') {
                    if(this.enabled.autoWatched && percent >= this.thresholds.watchedPercent) {
                        if(!Core.is('watched', item)) {
                            Core.add('watched', item);
                            Lampa.Noty.show('✅ Добавлено в "Просмотрено"', { time: 2000 });
                        }
                    } else if(this.enabled.autoWatching && percent >= this.thresholds.watchingPercent) {
                        if(!Core.is('watched', item) && !Core.is('watching', item)) {
                            Core.add('watching', item);
                            Lampa.Noty.show('👁️ Добавлено в "Смотрю"', { time: 2000 });
                        }
                    }
                } else if(type === 'tv') {
                    // Для сериалов: проверяем последнюю серию последнего сезона
                    if(this.enabled.autoWatched && this.isLastEpisode(id, season, episode)) {
                        if(!Core.is('watched', item)) {
                            Core.add('watched', item);
                            Lampa.Noty.show('✅ Сериал добавлен в "Просмотрено"', { time: 2000 });
                        }
                    } else if(this.enabled.autoWatching && percent >= this.thresholds.watchingPercent) {
                        if(!Core.is('watched', item) && !Core.is('watching', item)) {
                            Core.add('watching', item);
                            Lampa.Noty.show('👁️ Сериал добавлен в "Смотрю"', { time: 2000 });
                        }
                    }
                }
            },
            
            async isLastEpisode(tvId, currentSeason, currentEpisode) {
                return new Promise((resolve) => {
                    // Получаем информацию о сериале через TMDB
                    Lampa.TMDB.get(`tv/${tvId}`, {}, (data) => {
                        const lastSeason = data.seasons[data.seasons.length - 1];
                        if(!lastSeason || lastSeason.season_number !== currentSeason) {
                            resolve(false);
                            return;
                        }
                        // Получаем эпизоды последнего сезона
                        Lampa.TMDB.get(`tv/${tvId}/season/${currentSeason}`, {}, (seasonData) => {
                            const lastEpisode = seasonData.episodes[seasonData.episodes.length - 1];
                            resolve(lastEpisode && lastEpisode.episode_number === currentEpisode);
                        }, () => resolve(false));
                    }, () => resolve(false));
                });
            },
            
            checkDropped() {
                if(!this.enabled.autoDropped) return;
                const now = Date.now();
                const maxGap = this.thresholds.droppedDays * 24 * 60 * 60 * 1000;
                
                for(const item of Core.data.watching) {
                    const lastTimestamp = TimeKeeper.getLastForTv(item.id);
                    if(lastTimestamp && (now - lastTimestamp.updated) > maxGap) {
                        Core.add('dropped', { id: item.id, title: item.title });
                        Lampa.Noty.show(`❌ "${item.title}" перемещен в "Брошено" (30 дней без просмотра)`, { time: 3000 });
                    }
                }
            },
            
            cleanupWatched() {
                if(!this.enabled.autoCleanup) return;
                const now = Date.now();
                const maxAge = this.thresholds.cleanupDays * 24 * 60 * 60 * 1000;
                
                for(const item of Core.data.watched) {
                    const timestamp = TimeKeeper.getLastForMovie(item.id);
                    if(timestamp && (now - timestamp.updated) > maxAge) {
                        Core.remove('watched', { id: item.id, title: item.title });
                    }
                }
            }
        };
        
        // ==================== 4. СИНХРОНИЗАЦИЯ ЧЕРЕЗ GITHUB GIST ====================
        const CloudSync = {
            config: {
                gistId: null,
                token: null,
                strategy: 'time', // 'time' или 'date'
                autoSync: true,
                interval: 3600000 // 1 час
            },
            
            init() {
                const saved = Lampa.Storage.get('smart_sync_config', null);
                if(saved) this.config = { ...this.config, ...saved };
                if(this.config.autoSync && this.config.token && this.config.gistId) {
                    this.startAutoSync();
                }
            },
            
            saveConfig() {
                Lampa.Storage.set('smart_sync_config', this.config);
            },
            
            startAutoSync() {
                if(this.syncInterval) clearInterval(this.syncInterval);
                this.syncInterval = setInterval(() => this.download(), this.config.interval);
            },
            
            async upload() {
                if(!this.config.token || !this.config.gistId) {
                    Lampa.Noty.show('⚠️ Настройте Gist синхронизацию в настройках', { time: 3000 });
                    return false;
                }
                
                const data = {
                    collections: Core.data,
                    timestamps: TimeKeeper.data,
                    logs: Core.logs
                };
                
                const files = {
                    'collections.json': { content: JSON.stringify(data.collections, null, 2) },
                    'timestamps.json': { content: JSON.stringify(data.timestamps, null, 2) },
                    'logs.json': { content: JSON.stringify(data.logs, null, 2) }
                };
                
                return fetch(`https://api.github.com/gists/${this.config.gistId}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `token ${this.config.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ files })
                }).then(r => r.json()).then(() => {
                    Lampa.Noty.show('☁️ Синхронизация выполнена', { time: 2000 });
                    return true;
                }).catch(e => {
                    console.error('Sync upload error:', e);
                    Lampa.Noty.show('❌ Ошибка синхронизации', { time: 3000 });
                    return false;
                });
            },
            
            async download() {
                if(!this.config.token || !this.config.gistId) return false;
                
                return fetch(`https://api.github.com/gists/${this.config.gistId}`, {
                    headers: { 'Authorization': `token ${this.config.token}` }
                }).then(r => r.json()).then(gist => {
                    const remoteCollections = JSON.parse(gist.files['collections.json']?.content || '{}');
                    const remoteTimestamps = JSON.parse(gist.files['timestamps.json']?.content || '{}');
                    
                    if(this.config.strategy === 'time') {
                        this.mergeByTime(remoteCollections, remoteTimestamps);
                    } else {
                        this.mergeByDate(remoteCollections, remoteTimestamps);
                    }
                    
                    Lampa.Noty.show('☁️ Данные синхронизированы', { time: 2000 });
                    return true;
                }).catch(e => {
                    console.error('Sync download error:', e);
                    return false;
                });
            },
            
            mergeByTime(remoteCollections, remoteTimestamps) {
                // Простая стратегия: берем то, что новее по updated
                for(const cat of Core.categories) {
                    const remote = remoteCollections[cat] || [];
                    const local = Core.data[cat];
                    
                    const merged = [...local];
                    for(const rItem of remote) {
                        const localItem = local.find(l => l.id === rItem.id);
                        if(!localItem || (rItem.added > localItem.added)) {
                            merged.push(rItem);
                        }
                    }
                    Core.data[cat] = merged;
                }
                
                for(const key in remoteTimestamps) {
                    const remote = remoteTimestamps[key];
                    const local = TimeKeeper.data[key];
                    if(!local || remote.updated > local.updated) {
                        TimeKeeper.data[key] = remote;
                    }
                }
                
                Core.save();
                TimeKeeper.save();
            },
            
            mergeByDate(remoteCollections, remoteTimestamps) {
                this.mergeByTime(remoteCollections, remoteTimestamps);
            },
            
            exportData() {
                const exportObj = {
                    version: '1.0',
                    exportDate: Date.now(),
                    collections: Core.data,
                    timestamps: TimeKeeper.data,
                    logs: Core.logs
                };
                const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `smart_collections_backup_${new Date().toISOString().slice(0,19)}.json`;
                a.click();
                URL.revokeObjectURL(url);
            },
            
            importData(file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = JSON.parse(e.target.result);
                        if(data.collections) Core.data = data.collections;
                        if(data.timestamps) TimeKeeper.data = data.timestamps;
                        if(data.logs) Core.logs = data.logs;
                        Core.save();
                        TimeKeeper.save();
                        Lampa.Noty.show('✅ Импорт выполнен', { time: 2000 });
                        Lampa.Controller.toggle('content');
                    } catch(err) {
                        Lampa.Noty.show('❌ Ошибка импорта', { time: 3000 });
                    }
                };
                reader.readAsText(file);
            }
        };
        
        // ==================== 5. ОТСЛЕЖИВАНИЕ НОВЫХ СЕРИЙ ====================
        const NewEpisodesTracker = {
            enabled: true,
            interval: 21600000, // 6 часов
            lastCheck: 0,
            newEpisodes: [],
            
            init() {
                if(this.enabled) this.start();
            },
            
            start() {
                if(this.timer) clearInterval(this.timer);
                this.timer = setInterval(() => this.check(), this.interval);
                this.check();
            },
            
            async check() {
                if(!this.enabled) return;
                const now = Date.now();
                if(now - this.lastCheck < this.interval && this.lastCheck) return;
                this.lastCheck = now;
                
                const watching = [...Core.data.watching, ...Core.data.planned];
                const newFound = [];
                
                for(const item of watching) {
                    try {
                        const hasNew = await this.checkSeries(item.id);
                        if(hasNew) {
                            newFound.push(item);
                            if(!this.newEpisodes.find(n => n.id === item.id)) {
                                this.newEpisodes.push({ id: item.id, title: item.title, detected: now });
                            }
                        }
                    } catch(e) {}
                }
                
                if(newFound.length) {
                    this.showNotification(newFound);
                    this.updateBadge();
                }
            },
            
            checkSeries(tvId) {
                return new Promise((resolve) => {
                    Lampa.TMDB.get(`tv/${tvId}`, {}, (data) => {
                        const lastTimestamp = TimeKeeper.getLastForTv(tvId);
                        const lastWatchedSeason = lastTimestamp?.season || 0;
                        const lastWatchedEpisode = lastTimestamp?.episode || 0;
                        
                        let hasNew = false;
                        for(const season of data.seasons) {
                            if(season.season_number > lastWatchedSeason && season.episode_count > 0) {
                                hasNew = true;
                                break;
                            }
                        }
                        resolve(hasNew);
                    }, () => resolve(false));
                });
            },
            
            showNotification(items) {
                const titles = items.map(i => i.title).join(', ');
                Lampa.Noty.show(`🔥 Новые серии: ${titles}`, { time: 5000 });
                
                // Добавляем индикатор в меню "Избранное"
                const favMenu = document.querySelector('.menu__item[data-action="favorite"]');
                if(favMenu && !favMenu.querySelector('.new-episodes-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'new-episodes-badge';
                    badge.textContent = '🔔';
                    badge.style.marginLeft = '10px';
                    favMenu.appendChild(badge);
                }
            },
            
            updateBadge() {
                const count = this.newEpisodes.filter(e => Date.now() - e.detected < 7 * 24 * 3600000).length;
                const badge = document.querySelector('.new-episodes-badge');
                if(badge) badge.textContent = count > 0 ? `🔔 ${count}` : '';
            },
            
            clearBadge() {
                this.newEpisodes = [];
                const badge = document.querySelector('.new-episodes-badge');
                if(badge) badge.remove();
            },
            
            getNewEpisodesList() {
                return this.newEpisodes;
            }
        };
        
        // ==================== 6. UI КОМПОНЕНТЫ ====================
        
        // 6.1 Блок статуса на странице фильма
        const FullStatusBlock = Lampa.Utils.createClass({
            extend: Lampa.Interaction.Main,
            
            create() {
                const card = this.object.card;
                const status = Core.getMainCategory(card);
                const progress = TimeKeeper.getLastForMovie(card.id);
                
                const html = `
                    <div class="smart-status-block" style="margin: 15px 0; padding: 12px; background: rgba(255,255,255,0.1); border-radius: 12px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <div>
                                <span style="font-size: 1.2em;">📌 Статус:</span>
                                <span style="font-weight: bold; margin-left: 10px;">${status || 'Не указан'}</span>
                            </div>
                            ${progress ? `<div>🎬 Прогресс: ${Math.round(progress.percent)}%</div>` : ''}
                        </div>
                        <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
                            <button class="smart-status-btn selector" data-category="fav">⭐ Избранное</button>
                            <button class="smart-status-btn selector" data-category="watching">👁️ Смотрю</button>
                            <button class="smart-status-btn selector" data-category="planned">📋 Планы</button>
                            <button class="smart-status-btn selector" data-category="watched">✅ Просмотрено</button>
                            <button class="smart-status-btn selector" data-category="dropped">❌ Брошено</button>
                            <button class="smart-status-btn selector" data-category="collection">📦 Коллекция</button>
                            <button class="smart-status-btn selector" data-category="clear">🗑️ Удалить всё</button>
                        </div>
                    </div>
                `;
                
                this.html = $(html);
                
                this.html.find('.smart-status-btn').on('hover:enter', (e) => {
                    const cat = $(e.currentTarget).data('category');
                    if(cat === 'clear') {
                        this.showClearConfirm(card);
                    } else {
                        Core.toggle(cat, card);
                        this.updateStatusDisplay(card);
                    }
                });
                
                return this.html;
            },
            
            showClearConfirm(card) {
                Lampa.Modal.open({
                    title: 'Подтверждение',
                    html: '<div class="about">Удалить фильм из ВСЕХ категорий и очистить таймкоды?</div>',
                    buttons: [
                        { name: 'Отмена', onSelect: () => Lampa.Modal.close() },
                        { name: 'Удалить', onSelect: () => {
                            Core.clearAll(card);
                            this.updateStatusDisplay(card);
                            Lampa.Modal.close();
                            Lampa.Noty.show('🗑️ Данные очищены', { time: 2000 });
                        }}
                    ]
                });
            },
            
            updateStatusDisplay(card) {
                const newStatus = Core.getMainCategory(card);
                this.html.find('.smart-status-block > div:first-child span:last-child').text(newStatus || 'Не указан');
            }
        });
        
        // 6.2 Прогресс-бар на постере
        const CardProgressOverlay = {
            enabled: true,
            position: 'bottom', // top, center, bottom
            
            apply(cardElement, cardData) {
                if(!this.enabled) return;
                
                const progress = cardData.name ? 
                    TimeKeeper.getLastForTv(cardData.id) : 
                    TimeKeeper.getLastForMovie(cardData.id);
                
                if(!progress || progress.percent < 1) return;
                
                const overlay = document.createElement('div');
                overlay.className = `smart-progress-overlay smart-progress-${this.position}`;
                overlay.innerHTML = `
                    <div class="smart-progress-bar">
                        <div class="smart-progress-fill" style="width: ${Math.min(100, progress.percent)}%"></div>
                    </div>
                    <div class="smart-progress-text">${Math.round(progress.percent)}%</div>
                `;
                
                cardElement.querySelector('.card__img, .card__poster')?.appendChild(overlay);
            }
        };
        
        // 6.3 Меню "Избранное+" в боковой панели
        const SideMenuButton = {
            add() {
                const menu = document.querySelector('.menu__list');
                if(!menu) return;
                
                const item = document.createElement('li');
                item.className = 'menu__item selector';
                item.setAttribute('data-action', 'smart_collections');
                item.innerHTML = `
                    <svg class="menu__icon" width="24" height="24" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,7V13L16,16L16.5,15.2L12.5,12.8V7Z"/>
                    </svg>
                    <span class="menu__name">Избранное+</span>
                `;
                
                item.addEventListener('click', () => this.openMenu());
                menu.appendChild(item);
            },
            
            openMenu() {
                const categories = [
                    { name: 'fav', title: '⭐ Избранное', icon: '⭐' },
                    { name: 'watching', title: '👁️ Смотрю', icon: '👁️' },
                    { name: 'planned', title: '📋 Буду смотреть', icon: '📋' },
                    { name: 'watched', title: '✅ Просмотрено', icon: '✅' },
                    { name: 'dropped', title: '❌ Брошено', icon: '❌' },
                    { name: 'collection', title: '📦 Коллекция', icon: '📦' }
                ];
                
                const items = categories.map(cat => ({
                    title: cat.title,
                    onSelect: () => this.showCategory(cat.name, cat.title)
                }));
                
                items.push({ separator: true });
                items.push({ title: '📊 Статистика', onSelect: () => this.showStats() });
                items.push({ title: '📜 История действий', onSelect: () => this.showLogs() });
                items.push({ title: '🎲 Случайный фильм', onSelect: () => this.randomMovie() });
                items.push({ title: '⚙️ Настройки', onSelect: () => this.showSettings() });
                items.push({ title: '☁️ Синхронизация', onSelect: () => this.showSyncMenu() });
                
                Lampa.Select.show({
                    title: 'Избранное+',
                    items: items,
                    onBack: () => Lampa.Controller.toggle('content')
                });
            },
            
            showCategory(catName, catTitle) {
                const items = Core.data[catName];
                if(!items.length) {
                    Lampa.Noty.show(`📭 В "${catTitle}" ничего нет`, { time: 2000 });
                    return;
                }
                
                // Построение строки с карточками
                const rows = [];
                for(const item of items) {
                    rows.push({
                        title: item.title,
                        poster: item.poster,
                        onEnter: () => {
                            Lampa.Activity.push({
                                component: 'full',
                                id: item.id,
                                method: 'movie',
                                card: { id: item.id, title: item.title }
                            });
                        }
                    });
                }
                
                // Простой вывод через Select
                const selectItems = items.map(item => ({
                    title: item.title,
                    onSelect: () => {
                        Lampa.Activity.push({
                            component: 'full',
                            id: item.id,
                            method: 'movie',
                            card: { id: item.id, title: item.title }
                        });
                    }
                }));
                
                Lampa.Select.show({
                    title: catTitle,
                    items: selectItems,
                    onBack: () => Lampa.Controller.toggle('content')
                });
            },
            
            showStats() {
                const stats = TimeKeeper.getStatistics();
                const hours = Math.floor(stats.totalTime / 3600);
                const minutes = Math.floor((stats.totalTime % 3600) / 60);
                
                const html = `
                    <div style="padding: 15px;">
                        <div style="margin-bottom: 15px;">⏱️ Общее время: ${hours}ч ${minutes}мин</div>
                        <div style="margin-bottom: 15px;">🎬 Фильмов: ${stats.moviesCount}</div>
                        <div style="margin-bottom: 15px;">📺 Серий: ${stats.episodesCount}</div>
                        <div>📊 По категориям:</div>
                        ${Object.entries(stats.byCategory).map(([cat, time]) => `
                            <div style="margin-left: 15px;">${cat}: ${Math.floor(time / 3600)}ч</div>
                        `).join('')}
                    </div>
                `;
                
                Lampa.Modal.open({
                    title: '📊 Статистика просмотров',
                    html: html,
                    size: 'medium'
                });
            },
            
            showLogs() {
                const logs = Core.getLogs(50);
                const html = `<div style="max-height: 400px; overflow-y: auto;">
                    ${logs.map(log => `
                        <div style="padding: 8px; border-bottom: 1px solid #333;">
                            ${new Date(log.time).toLocaleString()} - 
                            ${log.action === 'add' ? '➕ Добавлен' : '🗑️ Удален'} 
                            в "${log.category}" (ID: ${log.item})
                        </div>
                    `).join('')}
                </div>`;
                
                Lampa.Modal.open({
                    title: '📜 История действий',
                    html: html,
                    size: 'medium'
                });
            },
            
            randomMovie() {
                const planned = Core.data.planned;
                const fav = Core.data.fav;
                const all = [...planned, ...fav];
                if(!all.length) {
                    Lampa.Noty.show('📭 Нет фильмов в "Планах" или "Избранном"', { time: 2000 });
                    return;
                }
                const random = all[Math.floor(Math.random() * all.length)];
                Lampa.Activity.push({
                    component: 'full',
                    id: random.id,
                    method: 'movie',
                    card: { id: random.id, title: random.title }
                });
            },
            
            showSettings() {
                const items = [
                    { title: '🤖 Авто-«Смотрю»', type: 'trigger', key: 'autoWatching', value: AutoRules.enabled.autoWatching },
                    { title: '✅ Авто-«Просмотрено»', type: 'trigger', key: 'autoWatched', value: AutoRules.enabled.autoWatched },
                    { title: '❌ Авто-«Брошено»', type: 'trigger', key: 'autoDropped', value: AutoRules.enabled.autoDropped },
                    { title: '🧹 Авто-очистка', type: 'trigger', key: 'autoCleanup', value: AutoRules.enabled.autoCleanup },
                    { separator: true },
                    { title: `📊 Порог «Смотрю»: ${AutoRules.thresholds.watchingPercent}%`, type: 'slider', key: 'watchingPercent', min: 1, max: 50 },
                    { title: `🏁 Порог «Просмотрено»: ${AutoRules.thresholds.watchedPercent}%`, type: 'slider', key: 'watchedPercent', min: 80, max: 100 },
                    { title: `⏰ Брошено через: ${AutoRules.thresholds.droppedDays} дней`, type: 'slider', key: 'droppedDays', min: 7, max: 90 },
                    { separator: true },
                    { title: '🎨 Прогресс на постере', type: 'trigger', key: 'progressOverlay', value: CardProgressOverlay.enabled },
                    { title: '📍 Позиция прогресса', type: 'select', key: 'progressPosition', value: CardProgressOverlay.position, options: ['bottom', 'center', 'top'] }
                ];
                
                const selectItems = items.map(item => ({
                    title: item.title,
                    ...(item.type === 'trigger' ? { checkbox: true, checked: item.value } : {}),
                    onSelect: () => {
                        if(item.type === 'trigger') {
                            AutoRules.enabled[item.key] = !AutoRules.enabled[item.key];
                            Lampa.Storage.set('smart_autorulex', AutoRules.enabled);
                            this.showSettings();
                        } else if(item.type === 'slider') {
                            // Для простоты: открываем меню ввода числа
                            Lampa.Prompt.show({
                                title: item.title,
                                value: AutoRules.thresholds[item.key],
                                onEnter: (val) => {
                                    AutoRules.thresholds[item.key] = parseInt(val);
                                    Lampa.Storage.set('smart_thresholds', AutoRules.thresholds);
                                    this.showSettings();
                                }
                            });
                        }
                    }
                }));
                
                Lampa.Select.show({
                    title: '⚙️ Настройки',
                    items: selectItems,
                    onBack: () => Lampa.Controller.toggle('content')
                });
            },
            
            showSyncMenu() {
                const items = [
                    { title: '☁️ Выгрузить в Gist', onSelect: () => CloudSync.upload() },
                    { title: '☁️ Загрузить из Gist', onSelect: () => CloudSync.download() },
                    { title: '📤 Экспорт в JSON', onSelect: () => CloudSync.exportData() },
                    { title: '📥 Импорт из JSON', onSelect: () => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.json';
                        input.onchange = (e) => CloudSync.importData(e.target.files[0]);
                        input.click();
                    }},
                    { separator: true },
                    { title: '🔧 Настроить Gist', onSelect: () => this.setupGist() }
                ];
                
                Lampa.Select.show({
                    title: '☁️ Синхронизация',
                    items: items,
                    onBack: () => Lampa.Controller.toggle('content')
                });
            },
            
            setupGist() {
                Lampa.Prompt.show({
                    title: 'Token GitHub',
                    placeholder: 'Введите personal access token',
                    onEnter: (token) => {
                        CloudSync.config.token = token;
                        Lampa.Prompt.show({
                            title: 'Gist ID',
                            placeholder: 'Введите ID Gist',
                            onEnter: (gistId) => {
                                CloudSync.config.gistId = gistId;
                                CloudSync.saveConfig();
                                Lampa.Noty.show('✅ Настройки сохранены', { time: 2000 });
                            }
                        });
                    }
                });
            }
        };
        
        // 6.4 Строка "Продолжить просмотр" в главном меню
        const ContinueWatchRow = {
            build() {
                const watching = Core.data.watching;
                const items = [];
                
                for(const item of watching) {
                    const progress = TimeKeeper.getLastForMovie(item.id);
                    if(progress && progress.percent > 0 && progress.percent < 95) {
                        items.push({
                            title: item.title,
                            subtitle: `${Math.round(progress.percent)}%`,
                            onEnter: () => {
                                Lampa.Activity.push({
                                    component: 'full',
                                    id: item.id,
                                    method: 'movie',
                                    card: { id: item.id, title: item.title }
                                });
                            }
                        });
                    }
                }
                
                if(!items.length) return null;
                
                return {
                    title: '🎬 Продолжить просмотр',
                    results: items.slice(0, 20),
                    params: {
                        module: Lampa.Interaction.LineModule.toggle(Lampa.Interaction.LineModule.MASK.base, 'More')
                    }
                };
            }
        };
        
        // 6.5 Строка "Скоро" (новые серии)
        const UpcomingEpisodesRow = {
            build() {
                const newEpisodes = NewEpisodesTracker.getNewEpisodesList();
                if(!newEpisodes.length) return null;
                
                return {
                    title: '🔥 Новые серии',
                    results: newEpisodes.slice(0, 10).map(ep => ({
                        title: ep.title,
                        subtitle: 'Доступны новые серии!',
                        onEnter: () => {
                            Lampa.Activity.push({
                                component: 'full',
                                id: ep.id,
                                method: 'tv',
                                card: { id: ep.id, title: ep.title }
                            });
                        }
                    })),
                    params: {
                        module: Lampa.Interaction.LineModule.toggle(Lampa.Interaction.LineModule.MASK.base, 'More')
                    }
                };
            }
        };
        
        // ==================== 7. ИНТЕГРАЦИЯ В LAMPA ====================
        
        // Загрузка сохраненных настроек
        const savedRules = Lampa.Storage.get('smart_autorulex', null);
        if(savedRules) AutoRules.enabled = { ...AutoRules.enabled, ...savedRules };
        
        const savedThresholds = Lampa.Storage.get('smart_thresholds', null);
        if(savedThresholds) AutoRules.thresholds = { ...AutoRules.thresholds, ...savedThresholds };
        
        const savedProgressSettings = Lampa.Storage.get('smart_progress_settings', null);
        if(savedProgressSettings) {
            CardProgressOverlay.enabled = savedProgressSettings.enabled ?? true;
            CardProgressOverlay.position = savedProgressSettings.position ?? 'bottom';
        }
        
        // Инициализация хранилищ
        Core.load();
        TimeKeeper.load();
        CloudSync.init();
        NewEpisodesTracker.init();
        
        // Добавление строк в ContentRows
        Lampa.ContentRows.add({
            name: 'continue_watch_plus',
            title: 'Продолжить просмотр',
            screen: ['main', 'category'],
            index: 1,
            call: () => ContinueWatchRow.build()
        });
        
        Lampa.ContentRows.add({
            name: 'upcoming_episodes',
            title: 'Новые серии',
            screen: ['main'],
            index: 2,
            call: () => UpcomingEpisodesRow.build()
        });
        
        // Добавление кнопки в боковое меню
        setTimeout(() => SideMenuButton.add(), 1000);
        
        // Перехват создания карточек для добавления прогресс-бара
        Lampa.Listener.follow('card:create', (card) => {
            if(CardProgressOverlay.enabled && card.element) {
                setTimeout(() => CardProgressOverlay.apply(card.element, card.data), 100);
            }
        });
        
        // Переопределение компонента Full для добавления блока статуса
        const originalFull = Lampa.Component.get('full');
        Lampa.Component.add('full', (object) => {
            const instance = originalFull(object);
            instance.use({
                onCreateAndAppend: (component) => {
                    if(component === 'start') {
                        setTimeout(() => {
                            const statusBlock = new FullStatusBlock(object);
                            statusBlock.create();
                            instance.html.find('.scroll__body').append(statusBlock.render());
                        }, 500);
                    }
                }
            });
            return instance;
        });
        
        // Периодическая проверка брошенных и очистка
        setInterval(() => {
            AutoRules.checkDropped();
            AutoRules.cleanupWatched();
        }, 24 * 60 * 60 * 1000); // Раз в сутки
        
        // Сохранение настроек при закрытии
        window.addEventListener('beforeunload', () => {
            Lampa.Storage.set('smart_autorulex', AutoRules.enabled);
            Lampa.Storage.set('smart_thresholds', AutoRules.thresholds);
            Lampa.Storage.set('smart_progress_settings', {
                enabled: CardProgressOverlay.enabled,
                position: CardProgressOverlay.position
            });
        });
        
        console.log('✅ Smart Collections+ плагин загружен');
    }
})();
