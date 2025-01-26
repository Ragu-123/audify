class MusicPlayer {
    constructor() {
        this.initializeElements();
        this.attachEventListeners();
        this.queue = [];
        this.currentTrackIndex = -1;
        this.setupAudio();
        this.loadingRelated = false;
        this.relatedContentTimeout = null;
        this.isInitialSearch = true;
        this.nextAudio = null;  // For preloading next track
        this.preloadStarted = false;
        this.seenTrackIds = new Set();  // Track seen songs
        this.queueEndThreshold = 3;  // Load more when n songs remain
        this.maxQueueSize = 20;  
        this.downloadsList = document.getElementById('downloadsList');
        this.loadDownloadedSongs();

        // Add mini player elements
        this.miniPlayer = document.querySelector('.mini-player');
        this.miniThumbnail = document.getElementById('miniThumbnail');
        this.miniTitle = document.getElementById('miniTitle');
        this.miniArtist = document.getElementById('miniArtist');
        
        // Add scroll listener
        this.setupScrollListener();

        this.isPlayingDownloads = false;
        this.upNextSection = document.querySelector('.up-next-section');
        this.appContainer = document.querySelector('.app-container');

        this.toggleUpNextBtn = document.getElementById('toggleUpNext');
        this.setupUpNextToggle();

        this.welcomeMessage = document.getElementById('welcomeMessage');
        this.nowPlayingSection = document.getElementById('nowPlayingSection');
        this.playerControls = document.getElementById('playerControls');
        
        // Initially hide player sections
        this.nowPlayingSection.classList.add('hidden');
        this.playerControls.classList.add('hidden');

        // Load initial recommendations
        this.loadInitialRecommendations();

        this.recommendedSongs = new Set(); // Add new property to track recommended songs

        this.loadingMoreRecommendations = false;
        this.setupInfiniteScroll();

        this.playlists = new Map(); // Store playlists
        this.loadPlaylists();
        this.setupPlaylistHandlers();

        this.isPlayingPlaylist = false;
        this.currentPlaylist = null;

        this.setupNavigation();
    }

    setupAudio() {
        this.audio = new Audio();
        this.audio.crossOrigin = "anonymous";
        // Add error handling
        this.audio.addEventListener('error', (e) => {
            console.error('Audio error:', e.target.error);
            this.handlePlaybackError(e.target.error);
        });
        this.setupAudioEvents();
    }

    initializeElements() {
        // Search elements
        this.searchInput = document.getElementById('searchInput');
        this.searchBtn = document.getElementById('searchBtn');
        this.searchProgress = document.getElementById('searchProgress');

        // Player elements
        this.currentThumbnail = document.getElementById('currentThumbnail');
        this.currentTitle = document.getElementById('currentTitle');
        this.currentArtist = document.getElementById('currentArtist');
        this.downloadBtn = document.getElementById('downloadBtn');
        
        // Controls
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.progress = document.getElementById('progress');
        this.currentTime = document.getElementById('currentTime');
        this.duration = document.getElementById('duration');
        this.currentDuration = document.getElementById('currentDuration');
        this.shuffleBtn = document.getElementById('shuffleBtn');
        this.loopBtn = document.getElementById('loopBtn');
        
        // Queue elements
        this.queueList = document.getElementById('queueList');
        this.autoplayToggle = document.getElementById('autoplayToggle');
        this.loadMoreBtn = document.getElementById('loadMoreBtn');

        // Progress bar elements
        this.progressBar = document.getElementById('progressBar');
        this.progressHover = document.getElementById('progressHover');

          // Download quality buttons
          this.highQualityBtn = document.getElementById('downloadHighQuality');
          this.mediumQualityBtn = document.getElementById('downloadMediumQuality');
          this.lowQualityBtn = document.getElementById('downloadLowQuality');

        // Add progress thumbnail elements
        this.progressThumbnail = document.getElementById('progressThumbnail');
        this.progressTitle = document.getElementById('progressTitle');
        this.progressArtist = document.getElementById('progressArtist');

        // Add downloads dropdown elements
        this.downloadsHeader = document.getElementById('downloadsHeader');
        this.downloadsSection = document.querySelector('.downloads-section');
        this.downloadsGrid = document.getElementById('downloadsList');
        
        // Initialize downloads dropdown
        this.setupDownloadsDropdown();
    }

    setupDownloadsDropdown() {
        this.downloadsHeader.addEventListener('click', () => {
            this.downloadsSection.classList.toggle('expanded');
            this.downloadsGrid.classList.toggle('collapsed');
            
            // Load downloads if expanding and not already loaded
            if (this.downloadsSection.classList.contains('expanded') && 
                !this.downloadsGrid.children.length) {
                this.loadDownloadedSongs();
            }
        });
    }

    attachEventListeners() {
        this.searchBtn.addEventListener('click', () => this.search());
        this.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.search();
        });

        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn.addEventListener('click', () => this.playPrevious());
        this.nextBtn.addEventListener('click', () => this.playNext());
        this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
        this.downloadBtn.addEventListener('click', () => this.downloadCurrent());
        this.loadMoreBtn.addEventListener('click', () => this.loadMoreRelated());

        // Add progress bar interactions
        this.progressBar.addEventListener('mousedown', (e) => this.startSeeking(e));
        this.progressBar.addEventListener('mousemove', (e) => this.updateSeekHover(e));
        this.progressBar.addEventListener('mouseleave', () => this.hideSeekHover());

        this.shuffleBtn.addEventListener('click', () => this.toggleShuffle());
        this.loopBtn.addEventListener('click', () => this.toggleLoop());
    }

    setupAudioEvents() {
        this.audio.addEventListener('timeupdate', () => {
            this.updateProgress();
            this.handlePreload();
        });
        this.audio.addEventListener('ended', () => this.handleTrackEnd());
        // Add ended event for autoplay of downloaded songs
        this.audio.addEventListener('ended', async () => {
            if (this.autoplayToggle.checked && this.downloadedSongs && this.downloadedSongs.length > 0) {
                const nextIndex = (this.currentDownloadIndex + 1) % this.downloadedSongs.length;
                const nextSong = this.downloadedSongs[nextIndex];
                if (nextSong && nextSong.path) {  // Add null check
                    await this.playLocalFile(nextSong.path);
                    this.currentDownloadIndex = nextIndex;
                }
            }
            await this.handleTrackEnd();
        });
    }

    async search() {
        const query = this.searchInput.value.trim();
        if (!query) return;

        this.searchProgress.style.width = '30%';
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            this.searchProgress.style.width = '60%';
            const results = await response.json();
            this.handleSearchResults(results);
            
            // Load fresh recommendations after search
            await this.loadRecommendedSongs();
            
            this.searchProgress.style.width = '100%';
        } catch (error) {
            console.error('Search failed:', error);
        } finally {
            setTimeout(() => {
                this.searchProgress.style.width = '0';
            }, 1000);
        }
    }

    handleSearchResults(results) {
        // Reset seen tracks when new search is performed
        this.seenTrackIds.clear();
        this.queue = results;
        results.forEach(track => this.seenTrackIds.add(track.id));
        this.renderQueue();
        if (results.length > 0) {
            this.isInitialSearch = true;
            this.playTrack(0);
        }
    }

    renderQueue() {
        this.queueList.innerHTML = this.queue.map((track, index) => `
            <div class="queue-item" data-index="${index}">
                <img src="${track.thumbnails[0].url}" alt="${track.title}">
                <div class="track-info">
                    <div class="title">${track.title || 'Unknown Title'}</div>
                    <div class="artist">${track.uploader || 'Unknown Artist'}</div>
                </div>
                <button class="song-menu-btn">
                    <i class="ri-more-2-fill"></i>
                </button>
            </div>
        `).join('');

        // Add click handlers for queue items
        this.queueList.querySelectorAll('.queue-item').forEach(item => {
            const index = parseInt(item.dataset.index);
            const track = this.queue[index];
            
            // Play track on click
            item.addEventListener('click', () => {
                this.playTrack(index);
            });

            // Add menu button handler
            const menuBtn = item.querySelector('.song-menu-btn');
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent track from playing when clicking menu
                this.showQueueItemMenu(track, menuBtn, index);
            });
        });

        // Add visual indicator for remaining tracks
        const remainingTracks = this.queue.length - (this.currentTrackIndex + 1);
        if (remainingTracks <= this.queueEndThreshold) {
            this.loadMoreBtn.classList.add('loading');
            this.loadMoreRelated();
        } else {
            this.loadMoreBtn.classList.remove('loading');
        }
    }

    // Add new method for queue item menu
    async showQueueItemMenu(track, menuBtn, index) {
        // Remove any existing menus
        const existingMenu = document.querySelector('.song-menu');
        if (existingMenu) existingMenu.remove();
    
        const menu = document.createElement('div');
        menu.className = 'song-menu';
        
        const items = [
            {
                text: 'Remove from Queue',
                icon: 'ri-delete-bin-line',
                action: () => {
                    this.queue.splice(index, 1);
                    this.renderQueue();
                    menu.remove();
                    // Adjust currentTrackIndex if needed
                    if (index < this.currentTrackIndex) {
                        this.currentTrackIndex--;
                    }
                }
            },
            {
                text: 'Add to Playlist',
                icon: 'ri-playlist-add-line',
                action: () => {
                    this.toggleSongInPlaylist(track);
                    menu.remove();
                }
            },
            {
                text: 'Download',
                icon: 'ri-download-2-line',
                action: async () => {
                    menu.remove();
                    await this.downloadSong(track);
                }
            }
        ];
    
        menu.innerHTML = items.map((item, i) => `
            <div class="song-menu-item" data-index="${i}">
                <i class="${item.icon}"></i>
                ${item.text}
            </div>
        `).join('');
    
        // Position the menu
        const rect = menuBtn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom}px`;
        menu.style.right = `${window.innerWidth - rect.right}px`;
        document.body.appendChild(menu);
    
        // Add click handlers
        menu.querySelectorAll('.song-menu-item').forEach((item, i) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                items[i].action();
            });
        });
    
        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !menuBtn.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);
    }

    async playTrack(index) {
        if (this.isPlayingPlaylist) {
            this.upNextSection.classList.add('hidden');
            this.appContainer.classList.add('upnext-collapsed');
        } else {
            this.upNextSection.classList.remove('hidden');
            this.appContainer.classList.remove('upnext-collapsed');
        }

        this.isPlayingDownloads = false;
        this.nowPlayingSection.classList.remove('hidden');
        await this.loadRecommendedSongs(); // Load recommendations when playing searched tracks
        // Show up next section when playing searched tracks
        this.isPlayingDownloads = false;
        this.upNextSection.classList.remove('hidden');
        this.appContainer.classList.remove('downloads-playing');
        
        try {
            // Hide welcome message and show player sections
            this.welcomeMessage.classList.add('hidden');
            this.nowPlayingSection.classList.remove('hidden');
            this.playerControls.classList.remove('hidden');
            
            // Reset preload state
            this.preloadStarted = false;
            if (this.nextAudio) {
                this.nextAudio.pause();
                this.nextAudio.remove();
                this.nextAudio = null;
                this.nextTrack = null;
            }

            if (index < 0 || index >= this.queue.length) return;
            
            const track = this.queue[index];
            this.currentTrackIndex = index;

            // Update display before loading
            this.updatePlayerDisplay({
                thumbnails: [{ url: track.thumbnails[0].url }],
                title: 'Loading...',
                uploader: track.uploader || 'Unknown Artist'
            });
            
            // Get stream URL
            const response = await fetch(`/api/stream/${track.id}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (!data.proxied_url) throw new Error('No stream URL in response');

            // Create and setup new audio element before removing old one
            const newAudio = new Audio();
            newAudio.crossOrigin = "anonymous";
            newAudio.src = data.proxied_url;
            await newAudio.load(); // Preload the audio

            // Switch audio elements
            const oldAudio = this.audio;
            this.audio = newAudio;
            this.setupAudioEvents();
            
            // Start playback
            await this.audio.play();
            
            // Clean up old audio after successful play
            if (oldAudio) {
                oldAudio.pause();
                oldAudio.remove();
            }

            // Update display with track info
            this.updatePlayerDisplay({
                thumbnails: [{ url: track.thumbnails[0].url }],
                title: track.title,
                uploader: track.uploader
            });
            this.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            
            // Load related content if needed
            if (this.isInitialSearch && this.autoplayToggle.checked) {
                this.isInitialSearch = false;
                this.loadRelatedContent(track.id);
            }
        } catch (error) {
            console.error('Track loading failed:', error);
            this.handlePlaybackError(error);
        }
    }

    handlePlaybackError(error) {
        this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        this.updatePlayerDisplay({
            thumbnail: '/static/default-thumbnail.png',
            title: 'Error playing track',
            uploader: 'Please try another track'
        });
        console.error('Playback error:', error);
    }

    updatePlayerDisplay(track) {
        // Handle both downloaded tracks and search results
        const thumbnail = track.thumbnails ? track.thumbnails[0]?.url : track.thumbnail;
        
        if (this.currentThumbnail) {
            this.currentThumbnail.src = thumbnail || '';
        }
        if (this.miniThumbnail) {
            this.miniThumbnail.src = thumbnail || '';
        }
        if (this.progressThumbnail) {
            this.progressThumbnail.src = thumbnail || '';
        }
        if (this.currentTitle) {
            this.currentTitle.textContent = track.title || 'Unknown Title';
        }
        if (this.currentArtist) {
            this.currentArtist.textContent = track.uploader || 'Unknown Artist';
        }
        if (this.currentDuration) {
            this.currentDuration.textContent = track.duration || '0:00';
        }

        // Update mini player
        if (this.miniTitle) {
            this.miniTitle.textContent = track.title || 'Unknown Title';
        }
        if (this.miniArtist) {
            this.miniArtist.textContent = track.uploader || 'Unknown Artist';
        }

        // Update progress bar thumbnail and info
        if (this.progressTitle) {
            this.progressTitle.textContent = track.title || 'Unknown Title';
        }
        if (this.progressArtist) {
            this.progressArtist.textContent = track.uploader || 'Unknown Artist';
        }
    }

    togglePlayPause() {
        if (this.audio.paused) {
            this.audio.play();
            this.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        } else {
            this.audio.pause();
            this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        }
    }

    playNext() {
        if (this.currentTrackIndex < this.queue.length - 1) {
            this.playTrack(this.currentTrackIndex + 1);
        }
    }

    playPrevious() {
        if (this.currentTrackIndex > 0) {
            this.playTrack(this.currentTrackIndex - 1);
        }
    }

    setVolume(value) {
        this.audio.volume = value / 100;
    }

    updateProgress() {
        const percent = (this.audio.currentTime / this.audio.duration) * 100;
        this.progress.style.width = `${percent}%`;
        
        this.currentTime.textContent = this.formatTime(this.audio.currentTime);
        this.duration.textContent = this.formatTime(this.audio.duration);
    }

    formatTime(seconds) {
        if (!seconds) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    handlePreload() {
        if (!this.preloadStarted && this.audio.duration > 0) {
            const progress = (this.audio.currentTime / this.audio.duration) * 100;
            if (progress >= 80 && this.autoplayToggle.checked) {
                this.preloadStarted = true;
                this.preloadNextTrack();
            }
        }
    }

    async preloadNextTrack() {
        const nextIndex = this.currentTrackIndex + 1;
        if (nextIndex >= this.queue.length) {
            await this.loadMoreRelated();  // Load more tracks if we're at the end
            return;
        }

        try {
            const nextTrack = this.queue[nextIndex];
            console.log('Preloading next track:', nextTrack.title);
            
            const response = await fetch(`/api/stream/${nextTrack.id}`);
            if (!response.ok) throw new Error('Failed to preload');
            
            const data = await response.json();
            if (!data.proxied_url) throw new Error('No stream URL');

            // Create and load the next audio element
            this.nextAudio = new Audio();
            this.nextAudio.crossOrigin = "anonymous";
            this.nextAudio.src = data.proxied_url;
            this.nextAudio.load();  // Start buffering
            
            // Store next track info
            this.nextTrack = {
                track: nextTrack,
                streamData: data
            };
        } catch (error) {
            console.error('Preload failed:', error);
            this.nextAudio = null;
            this.nextTrack = null;
        }
    }

    async handleTrackEnd() {
        if (this.isPlayingPlaylist) {
            // Handle playlist autoplay
            const nextIndex = this.currentTrackIndex + 1;
            if (nextIndex < this.queue.length) {
                this.playTrack(nextIndex);
            } else {
                // Playlist ended, stop playback
                this.currentTrackIndex = -1;
                this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            }
            return;
        }

        if (this.isPlayingDownloads) {
            // Handle autoplay for downloads
            if (this.autoplayToggle.checked && this.downloadedSongs && this.downloadedSongs.length > 0) {
                const nextIndex = (this.currentDownloadIndex + 1) % this.downloadedSongs.length;
                const nextSong = this.downloadedSongs[nextIndex];
                if (nextSong && nextSong.path) {  // Add null check
                    await this.playLocalFile(nextSong.path);
                    this.currentDownloadIndex = nextIndex;
                }
            }
        } else {
            // Existing track end handling for searched tracks
            if (this.autoplayToggle.checked && this.queue.length > 0) {
                // Check if we need to load more tracks
                const remainingTracks = this.queue.length - (this.currentTrackIndex + 1);
                if (remainingTracks <= this.queueEndThreshold) {
                    const currentTrack = this.queue[this.currentTrackIndex];
                    if (currentTrack && currentTrack.id) {  // Add null check
                        await this.loadRelatedContent(currentTrack.id);
                    }
                }
                
                // Play next track
                const nextIndex = this.currentTrackIndex + 1;
                if (nextIndex < this.queue.length) {
                    this.playTrack(nextIndex);
                }
            }
        }
    }

    async playPreloadedTrack() {
        if (!this.nextAudio || !this.nextTrack) return;

        // Stop current playback
        this.audio.pause();
        const oldAudio = this.audio;

        // Switch to preloaded audio
        this.audio = this.nextAudio;
        this.setupAudioEvents();
        
        // Update display and start playback
        this.currentTrackIndex++;
        this.updatePlayerDisplay({
            thumbnails: [{ url: this.nextTrack.track.thumbnails[0].url }],
            title: this.nextTrack.track.title,
            uploader: this.nextTrack.track.uploader,
            duration: this.nextTrack.streamData.duration
        });
        
        try {
            await this.audio.play();
            this.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            
            // Clean up
            oldAudio.remove();
            this.nextAudio = null;
            this.nextTrack = null;
            this.preloadStarted = false;

            // Load related content if needed
            if (this.currentTrackIndex >= this.queue.length - 3) {
                this.loadMoreRelated();
            }
        } catch (error) {
            console.error('Playback failed:', error);
            this.handlePlaybackError(error);
        }
    }

    async loadRelatedContent(videoId) {
        if (this.isPlayingPlaylist) return; // Don't load related if playing playlist
        if (!videoId || this.loadingRelated) return;
        
        this.loadingRelated = true;
        try {
            const response = await fetch(`/api/related/${videoId}`);
            const related = await response.json();
            
            if (!this.queue[this.currentTrackIndex]) return;  // Add safety check
            
            // Filter out duplicates and seen tracks
            const uniqueRelated = related.filter(track => 
                track && track.id &&  // Add null check
                !this.seenTrackIds.has(track.id) &&
                track.title.toLowerCase() !== this.queue[this.currentTrackIndex].title.toLowerCase()
            );
            
            if (uniqueRelated.length > 0) {
                // Add new tracks to seen set
                uniqueRelated.forEach(track => this.seenTrackIds.add(track.id));
                
                // Keep current track and add new related tracks
                const currentTrack = this.queue[this.currentTrackIndex];
                const remainingTracks = this.queue.slice(this.currentTrackIndex + 1);
                
                // Trim queue if it's too long
                const totalTracks = [currentTrack, ...remainingTracks, ...uniqueRelated];
                this.queue = totalTracks.slice(0, this.maxQueueSize);
                
                this.renderQueue();
                console.log(`Added ${uniqueRelated.length} new tracks to queue`);

                // Automatically open up next section if it's collapsed
                if (this.upNextSection.classList.contains('collapsed')) {
                    this.toggleUpNextBtn.classList.remove('collapsed');
                    this.upNextSection.classList.remove('collapsed');
                    this.appContainer.classList.remove('upnext-collapsed');
                }
            }
        } catch (error) {
            console.error('Failed to load related tracks:', error);
        } finally {
            this.loadingRelated = false;
        }
    }

    async loadMoreRelated() {
        if (this.isPlayingPlaylist) return; // Don't load more if playing playlist
        if (this.currentTrackIndex >= 0 && this.queue.length > 0) {  // Add queue length check
            const currentTrack = this.queue[this.currentTrackIndex];
            if (currentTrack && currentTrack.id) {  // Add null check
                await this.loadRelatedContent(currentTrack.id);
            }
        }
    }

    async downloadCurrent() {
        if (this.currentTrackIndex < 0) return;
        
        const track = this.queue[this.currentTrackIndex];
        const downloadContainer = this.downloadBtn.parentElement;
        const progressCircle = downloadContainer.querySelector('.download-progress circle');
        
        try {
            downloadContainer.classList.add('downloading');
            this.downloadBtn.disabled = true;

            // Create event source for progress updates
            const eventSource = new EventSource(`/api/download/${track.id}/progress`);
            
            eventSource.onmessage = (event) => {
                const progress = JSON.parse(event.data).progress;
                // Update circle progress (100.5 is the circumference of the circle)
                const dashOffset = 100.5 - (progress * 100.5);
                progressCircle.style.strokeDashoffset = dashOffset;
            };

            const response = await fetch(`/api/download/${track.id}`);
            const result = await response.json();
            
            if (result.status === 'success') {
                // Complete the circle
                progressCircle.style.strokeDashoffset = 0;
                await this.loadDownloadedSongs();
                
                // Reset after a short delay
                setTimeout(() => {
                    downloadContainer.classList.remove('downloading');
                    progressCircle.style.strokeDashoffset = 100.5;
                    this.downloadBtn.disabled = false;
                }, 1000);
            }
            
            eventSource.close();
        } catch (error) {
            console.error('Download failed:', error);
            downloadContainer.classList.remove('downloading');
            this.downloadBtn.disabled = false;
        }
    }

    startSeeking(e) {
        e.preventDefault();
        
        // Store initial values
        const rect = this.progressBar.getBoundingClientRect();
        const initialX = rect.left;
        const barWidth = rect.width;
        
        const updateSeek = (e) => {
            requestAnimationFrame(() => {
                const pos = Math.max(0, Math.min((e.clientX - initialX) / barWidth, 1));
                this.progress.style.width = `${pos * 100}%`;
                
                if (this.audio.duration) {
                    const seekTime = pos * this.audio.duration;
                    this.currentTime.textContent = this.formatTime(seekTime);
                }
            });
        };

        const stopSeeking = (e) => {
            document.removeEventListener('mousemove', updateSeek);
            document.removeEventListener('mouseup', stopSeeking);
            
            const pos = Math.max(0, Math.min((e.clientX - initialX) / barWidth, 1));
            if (this.audio.duration) {
                this.audio.currentTime = pos * this.audio.duration;
            }
        };

        document.addEventListener('mousemove', updateSeek);
        document.addEventListener('mouseup', stopSeeking);
    }

    updateSeekHover(e) {
        if (!this.audio.duration) return;  // Don't show hover if no duration
        
        const rect = this.progressBar.getBoundingClientRect();
        const pos = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
        this.progressHover.style.width = `${pos * 100}%`;
        
        const hoverTime = this.formatTime(pos * this.audio.duration);
        this.progressHover.setAttribute('data-time', hoverTime);
    }

    hideSeekHover() {
        this.progressHover.style.width = '0';
    }

    async loadDownloadedSongs() {
        try {
            const response = await fetch('/api/downloads');
            const downloads = await response.json();
            this.renderDownloadsList(downloads);
            
            // Show downloads section if there are downloads
            if (downloads.length > 0) {
                this.downloadsSection.classList.add('expanded');
                this.downloadsGrid.classList.remove('collapsed');
            }
        } catch (error) {
            console.error('Failed to load downloads:', error);
        }
    }

    renderDownloadsList(downloads) {
        if (!this.downloadsList) return;
        
        if (downloads.length === 0) {
            this.downloadsList.innerHTML = `
                <div class="no-downloads-message">
                    No downloaded songs yet
                </div>
            `;
            return;
        }
        
        this.downloadsList.innerHTML = downloads.map((song, index) => `
            <div class="download-item" data-id="${song.id}" data-path="${song.path}" data-index="${index}">
                <div class="download-thumbnail">
                    <img src="${song.thumbnail || '/static/default-thumbnail.png'}" alt="${song.title}">
                    <button class="play-btn"><i class="ri-play-fill"></i></button>
                </div>
                <div class="download-info">
                    <h3>${song.title}</h3>
                    <p>${song.uploader}</p>
                </div>
                <div class="download-controls">
                    <button class="delete-btn" title="Delete">
                        <i class="ri-delete-bin-line"></i>
                    </button>
                </div>
            </div>
        `).join('');

        // Store downloads for autoplay functionality
        this.downloadedSongs = downloads;

        // Add click handlers for downloaded songs
        this.downloadsList.querySelectorAll('.download-item').forEach(item => {
            const playBtn = item.querySelector('.play-btn');
            const deleteBtn = item.querySelector('.delete-btn');
            
            playBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const index = parseInt(item.dataset.index);
                await this.playLocalFile(item.dataset.path);
                this.currentDownloadIndex = index;
            });

            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.deleteDownload(item.dataset.id);
            });
        });
    }

    async deleteDownload(trackId) {
        if (!confirm('Are you sure you want to delete this song?')) return;

        try {
            const response = await fetch(`/api/downloads/${trackId}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            
            if (result.status === 'success') {
                await this.loadDownloadedSongs(); // Refresh the list
            } else {
                alert('Failed to delete the song');
            }
        } catch (error) {
            console.error('Delete failed:', error);
            alert('Failed to delete the song');
        }
    }

    async playLocalFile(path) {
        const filename = path.split('/').pop();
        
        try {
            // Hide welcome message and show player sections
            this.welcomeMessage.classList.add('hidden');
            this.nowPlayingSection.classList.remove('hidden');
            this.playerControls.classList.remove('hidden');
            this.isPlayingDownloads = true;
            this.nowPlayingSection.classList.add('hidden'); // Hide recommendations when playing downloads
            
            // Stop current playback
            this.audio.pause();
            const oldAudio = this.audio;

            // Create new audio element
            this.audio = new Audio(`/api/local/${encodeURIComponent(filename)}`);
            this.setupAudioEvents();

            await this.audio.play();
            this.playPauseBtn.innerHTML = '<i class="ri-pause-fill"></i>';
            
            if (oldAudio) {
                oldAudio.remove();
            }

            // Update the display with local file info
            const downloads = await this.getDownloadsList();
            const currentTrack = downloads.find(track => track.path.includes(filename));
            
            if (currentTrack) {
                // Pass the track data in the correct format
                this.updatePlayerDisplay({
                    thumbnails: null,  // This will make the function use currentTrack.thumbnail
                    thumbnail: currentTrack.thumbnail,
                    title: currentTrack.title,
                    uploader: currentTrack.uploader
                });
            }
        } catch (error) {
            console.error('Local playback failed:', error);
            this.handlePlaybackError(error);
        }
    }

    async getDownloadsList() {
        const response = await fetch('/api/downloads');
        return await response.json();
    }

    setupScrollListener() {
        const mainContent = document.querySelector('.main-content');
        const nowPlayingSection = document.querySelector('.now-playing-top');
        
        mainContent.addEventListener('scroll', () => {
            if (nowPlayingSection) {
                const rect = nowPlayingSection.getBoundingClientRect();
                if (rect.bottom < 0) {
                    this.miniPlayer.classList.add('visible');
                } else {
                    this.miniPlayer.classList.remove('visible');
                }
            }
        });
    }

    setupUpNextToggle() {
        this.toggleUpNextBtn.addEventListener('click', () => {
            this.toggleUpNextBtn.classList.toggle('collapsed');
            this.upNextSection.classList.toggle('collapsed');
            this.appContainer.classList.toggle('upnext-collapsed');
        });
    }

    async loadRecommendedSongs() {
        const recommendedSection = document.getElementById('recommendedSongs');
        if (!recommendedSection) return;

        // Show loading spinner
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        recommendedSection.appendChild(spinner);

        try {
            // Get a random downloaded song to base recommendations on
            const downloads = await this.getDownloadsList();
            if (downloads.length > 0) {
                const randomSong = downloads[Math.floor(Math.random() * downloads.length)];
                
                // Search for related songs based on the random song's title
                const response = await fetch(`/api/search?q=${encodeURIComponent(randomSong.title)}`);
                const results = await response.json();
                
                if (results.length > 0) {
                    const firstResult = results[0];
                    const relatedResponse = await fetch(`/api/related/${firstResult.id}`);
                    const relatedSongs = await relatedResponse.json();
                    this.renderRecommendedSongs(relatedSongs);
                }
            }
        } catch (error) {
            console.error('Failed to load recommended songs:', error);
        } finally {
            // Remove loading spinner
            spinner.remove();
        }
    }

    renderRecommendedSongs(songs) {
        const recommendedSection = document.getElementById('recommendedSongs');
        if (!recommendedSection) return;

        // Record current scroll position
        const scrollPos = recommendedSection.parentElement.scrollTop;

        // Filter and append new songs
        songs.forEach(song => {
            if (!this.recommendedSongs.has(song.id)) {
                this.recommendedSongs.add(song.id);
                const songElement = this.createRecommendedSongElement(song);
                recommendedSection.appendChild(songElement);
            }
        });

        // Restore scroll position
        requestAnimationFrame(() => {
            recommendedSection.parentElement.scrollTop = scrollPos;
        });
    }

    createRecommendedSongElement(song) {
        const div = document.createElement('div');
        div.className = 'recommended-song-item';
        div.dataset.id = song.id;
        
        // Add song content
        div.innerHTML = `
            <div class="recommended-thumbnail">
                <img src="${song.thumbnails[0].url}" alt="${song.title}">
                <button class="recommended-play-btn">
                    <i class="ri-play-fill"></i>
                </button>
            </div>
            <div class="recommended-info">
                <h3>${song.title}</h3>
                <p>${song.uploader}</p>
            </div>
        `;

        // Add three-dot menu
        this.createSongMenu(song, div, 'recommended');

        // Add play button handler
        div.querySelector('.recommended-play-btn').addEventListener('click', async () => {
            const videoId = song.id;
            const response = await fetch(`/api/stream/${videoId}`);
            const streamData = await response.json();
            
            this.queue = [{ 
                id: videoId,
                title: song.title,
                uploader: song.uploader,
                thumbnails: [{ url: song.thumbnails[0].url }]
            }];
            this.playTrack(0);
        });

        return div;
    }

    async loadInitialRecommendations() {
        try {
            // Hide welcome message and show recommendations
            this.welcomeMessage.classList.add('hidden');
            this.nowPlayingSection.classList.remove('hidden');

            const response = await fetch('/api/recommendations');
            const recommendations = await response.json();
            
            if (recommendations && recommendations.length > 0) {
                this.recommendedSongs.clear(); // Clear set only on initial load
                this.renderRecommendedSongs(recommendations);
            } else {
                // If no recommendations, show default message
                this.welcomeMessage.classList.remove('hidden');
                this.nowPlayingSection.classList.add('hidden');
            }
        } catch (error) {
            console.error('Failed to load initial recommendations:', error);
            // Show welcome message if recommendations fail
            this.welcomeMessage.classList.remove('hidden');
            this.nowPlayingSection.classList.add('hidden');
        }
    }

    async loadMoreRecommendations() {
        if (this.loadingMoreRecommendations) return;
        this.loadingMoreRecommendations = true;

        try {
            // Get random downloaded song
            const downloads = await this.getDownloadsList();
            if (downloads.length > 0) {
                const randomSong = downloads[Math.floor(Math.random() * downloads.length)];
                const response = await fetch(`/api/search?q=${encodeURIComponent(randomSong.title)}`);
                const results = await response.json();
                
                if (results.length > 0) {
                    const firstResult = results[0];
                    const relatedResponse = await fetch(`/api/related/${firstResult.id}`);
                    const relatedSongs = await relatedResponse.json();
                    this.renderRecommendedSongs(relatedSongs);
                }
            }
        } catch (error) {
            console.error('Failed to load more recommendations:', error);
        } finally {
            this.loadingMoreRecommendations = false;
        }
    }

    setupInfiniteScroll() {
        const nowPlayingSection = document.querySelector('.now-playing-top');
        if (nowPlayingSection) {
            nowPlayingSection.addEventListener('scroll', () => {
                if (this.loadingMoreRecommendations) return;

                const {scrollTop, scrollHeight, clientHeight} = nowPlayingSection;
                // When user scrolls to bottom (with 100px threshold)
                if (scrollHeight - scrollTop <= clientHeight + 100) {
                    this.loadMoreRecommendations();
                }
            });
        }
    }

    setupPlaylistHandlers() {
        const createPlaylistBtn = document.querySelector('.create-playlist-btn');
        const importSpotifyBtn = document.querySelector('.import-spotify-btn');
        
        createPlaylistBtn.addEventListener('click', () => this.showCreatePlaylistDialog());
        importSpotifyBtn.addEventListener('click', () => this.showImportSpotifyDialog());
    }

    showCreatePlaylistDialog() {
        const dialog = document.createElement('div');
        dialog.className = 'playlist-dialog';
        dialog.innerHTML = `
            <h3>Create New Playlist</h3>
            <input type="text" placeholder="Playlist name" id="playlistName">
            <div class="dialog-buttons">
                <button class="cancel-btn">Cancel</button>
                <button class="create-btn">Create</button>
            </div>
        `;

        document.body.appendChild(dialog);

        const input = dialog.querySelector('#playlistName');
        dialog.querySelector('.cancel-btn').onclick = () => dialog.remove();
        dialog.querySelector('.create-btn').onclick = () => {
            const name = input.value.trim();
            if (name) {
                this.createPlaylist(name);
                dialog.remove();
            }
        };
    }

    showImportSpotifyDialog() {
        const dialog = document.createElement('div');
        dialog.className = 'playlist-dialog import-dialog';
        dialog.innerHTML = `
            <h3>Import Spotify Playlist</h3>
            <div class="input-group">
                <label for="playlistName">Playlist Name (Optional)</label>
                <input type="text" id="playlistName" placeholder="Enter playlist name">
            </div>
            <div class="input-group">
                <label for="spotifyUrl">Spotify Playlist URL</label>
                <input type="text" id="spotifyUrl" 
                    placeholder="https://open.spotify.com/playlist/...">
                <p class="hint">Copy the URL from Spotify desktop or web app</p>
            </div>
            <div class="import-progress" style="display: none">
                <div class="progress-text">Processing playlist...</div>
                <div class="progress-bar">
                    <div class="progress"></div>
                </div>
                <div class="progress-stats">
                    <span class="songs-processed">0</span> / <span class="total-songs">0</span> songs
                </div>
            </div>
            <div class="dialog-buttons">
                <button class="cancel-btn">Cancel</button>
                <button class="import-btn">Import</button>
            </div>
        `;

        document.body.appendChild(dialog);

        const nameInput = dialog.querySelector('#playlistName');
        const urlInput = dialog.querySelector('#spotifyUrl');
        const importBtn = dialog.querySelector('.import-btn');
        const progressBar = dialog.querySelector('.import-progress');
        const progressFill = dialog.querySelector('.progress');
        const songsProcessed = dialog.querySelector('.songs-processed');
        const totalSongs = dialog.querySelector('.total-songs');
        
        let progressInterval;

        const updateProgress = async () => {
            try {
                const response = await fetch('/api/playlists/import/progress');
                const data = await response.json();
                const progress = Math.round(data.progress);
                progressFill.style.width = `${progress}%`;
                songsProcessed.textContent = Math.round(progress * data.total_songs / 100);
                totalSongs.textContent = data.total_songs;
                return progress;
            } catch (error) {
                console.error('Error fetching progress:', error);
                return 0;
            }
        };

        dialog.querySelector('.cancel-btn').onclick = () => {
            if (progressInterval) clearInterval(progressInterval);
            dialog.remove();
        };

        importBtn.onclick = async () => {
            const url = urlInput.value.trim();
            if (!url) {
                alert('Please enter a Spotify playlist URL');
                return;
            }

            if (!url.includes('open.spotify.com/playlist/')) {
                alert('Please enter a valid Spotify playlist URL');
                return;
            }

            importBtn.disabled = true;
            progressBar.style.display = 'block';

            try {
                progressInterval = setInterval(updateProgress, 1000);

                const response = await fetch('/api/playlists/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: nameInput.value.trim(),
                        spotifyUrl: url
                    })
                });
                
                clearInterval(progressInterval);
                const result = await response.json();
                
                if (result.success) {
                    await this.loadPlaylists();
                    alert(`Successfully imported ${result.song_count} of ${result.total_songs} songs to playlist "${result.name}"!`);
                    dialog.remove();
                } else {
                    alert(result.error || 'Failed to import playlist');
                    importBtn.disabled = false;
                }
            } catch (error) {
                console.error('Import failed:', error);
                alert('Failed to import playlist');
                importBtn.disabled = false;
                clearInterval(progressInterval);
            }
        };
    }

    async importSpotifyPlaylist(name, url) {
        try {
            const response = await fetch('/api/playlists/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, spotifyUrl: url })
            });
            
            const result = await response.json();
            if (result.success) {
                await this.loadPlaylists();
                alert(`Successfully imported ${result.song_count} songs to playlist "${result.name}"!`);
            } else {
                alert(result.error || 'Failed to import playlist');
            }
        } catch (error) {
            console.error('Failed to import playlist:', error);
            alert('Failed to import playlist');
        }
    }

    async createPlaylist(name) {
        try {
            const response = await fetch('/api/playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const result = await response.json();
            if (result.success) {
                await this.loadPlaylists();
            }
        } catch (error) {
            console.error('Failed to create playlist:', error);
        }
    }

    createSongMenu(song, container, type) {
        const menuBtn = document.createElement('button');
        menuBtn.className = 'song-menu-btn';
        menuBtn.innerHTML = '<i class="ri-more-2-fill"></i>';
        
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            this.showSongMenu(song, menuBtn, type);
        };
        
        container.appendChild(menuBtn);
    }

    async showSongMenu(song, menuBtn, type) {
        // Remove any existing menus
        const existingMenu = document.querySelector('.song-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'song-menu';
        
        const items = [
            {
                text: 'Add to Queue',
                icon: 'ri-playlist-add-line',
                action: () => this.addToQueue(song)
            },
            {
                text: 'Add to Playlist',
                icon: 'ri-playlist-add-line',
                action: () => this.toggleSongInPlaylist(song)
            },
            {
                text: 'Download',
                icon: 'ri-download-2-line',
                action: async () => {
                    menu.remove();
                    await this.downloadSong(song);
                }
            }
        ];

        menu.innerHTML = items.map((item, index) => `
            <div class="song-menu-item" data-index="${index}">
                <i class="${item.icon}"></i>
                ${item.text}
            </div>
        `).join('');

        // Position the menu
        const rect = menuBtn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom}px`;
        menu.style.right = `${window.innerWidth - rect.right}px`;
        document.body.appendChild(menu);

        // Add click handlers
        menu.querySelectorAll('.song-menu-item').forEach((item, index) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                items[index].action();
            });
        });

        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !menuBtn.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);
    }

    async toggleSongInPlaylist(song) {
        const dialog = document.createElement('div');
        dialog.className = 'playlist-dialog';
        dialog.innerHTML = `
            <h3>Add to Playlist</h3>
            <div class="playlist-list">
                <div class="no-playlists-message">Loading playlists...</div>
            </div>
            <div class="dialog-buttons">
                <button class="create-new-btn">Create New Playlist</button>
                <button class="cancel-btn">Cancel</button>
            </div>
        `;

        document.body.appendChild(dialog);

        // Load playlists
        try {
            const playlists = await this.getPlaylists();
            const playlistList = dialog.querySelector('.playlist-list');
            playlistList.innerHTML = '';

            if (Object.keys(playlists).length === 0) {
                playlistList.innerHTML = '<div class="no-playlists-message">No playlists yet</div>';
            } else {
                Object.entries(playlists).forEach(([id, playlist]) => {
                    const isInPlaylist = playlist.songs.some(s => s.id === song.id);
                    const item = document.createElement('div');
                    item.className = 'playlist-item';
                    item.innerHTML = `
                        <span>${playlist.name}</span>
                        <span class="song-count">${playlist.songs.length} songs</span>
                        ${isInPlaylist ? '<span class="in-playlist">✓</span>' : ''}
                    `;
                    
                    item.addEventListener('click', async () => {
                        if (!isInPlaylist) {
                            await this.addSongToPlaylist(id, song);
                            dialog.remove();
                        }
                    });
                    
                    playlistList.appendChild(item);
                });
            }
        } catch (error) {
            console.error('Failed to load playlists:', error);
            playlistList.innerHTML = '<div class="no-playlists-message">Error loading playlists</div>';
        }

        // Add button handlers
        dialog.querySelector('.create-new-btn').onclick = () => {
            dialog.remove();
            this.showCreatePlaylistDialog(song);
        };
        dialog.querySelector('.cancel-btn').onclick = () => dialog.remove();
    }

    async loadPlaylists() {
        try {
            const response = await fetch('/api/playlists');
            const playlists = await response.json();
            this.playlists = playlists;
            this.renderPlaylists();
        } catch (error) {
            console.error('Failed to load playlists:', error);
        }
    }

    async getPlaylists() {
        try {
            const response = await fetch('/api/playlists');
            return await response.json();
        } catch (error) {
            console.error('Failed to get playlists:', error);
            return {};
        }
    }

    async isSongInAnyPlaylist(songId) {
        const playlists = await this.getPlaylists();
        return Object.values(playlists).some(playlist => 
            playlist.songs.some(song => song.id === songId)
        );
    }

    renderPlaylists() {
        const playlistsGrid = document.getElementById('playlistsGrid');
        if (!playlistsGrid) return;

        playlistsGrid.innerHTML = Object.entries(this.playlists).map(([id, playlist]) => `
            <div class="playlist-item" data-id="${id}">
                <h3>${playlist.name}</h3>
                <p>${playlist.songs.length} songs</p>
                <button class="delete-playlist-btn" title="Delete Playlist">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </div>
        `).join('');

        // Add click handlers
        playlistsGrid.querySelectorAll('.playlist-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('delete-playlist-btn') && !e.target.closest('.delete-playlist-btn')) {
                    this.openPlaylist(item.dataset.id);
                }
            });

            const deleteBtn = item.querySelector('.delete-playlist-btn');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.deletePlaylist(item.dataset.id);
            });
        });
    }

    async deletePlaylist(playlistId) {
        if (!confirm('Are you sure you want to delete this playlist?')) return;

        try {
            const response = await fetch(`/api/playlists/${playlistId}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            
            if (result.success) {
                await this.loadPlaylists(); // Refresh the list
            } else {
                alert('Failed to delete the playlist');
            }
        } catch (error) {
            console.error('Delete failed:', error);
            alert('Failed to delete the playlist');
        }
    }

    async openPlaylist(playlistId) {
        try {
            const playlists = await this.getPlaylists();
            const playlist = playlists[playlistId];
            if (!playlist) return;

            // Store current playlist
            this.currentPlaylist = {
                id: playlistId,
                name: playlist.name,
                songs: [...playlist.songs]
            };

            // Create and show playlist window
            const playlistWindow = document.createElement('div');
            playlistWindow.className = 'playlist-window';
            playlistWindow.innerHTML = `
                <div class="playlist-window-header">
                    <h2>${playlist.name}</h2>
                    <button class="close-playlist">
                        <i class="ri-close-line"></i>
                    </button>
                </div>
                <div class="playlist-songs">
                    ${playlist.songs.map((song, index) => `
                        <div class="playlist-song-item" data-id="${song.id}" data-index="${index}">
                            <div class="playlist-song-thumbnail">
                                <img src="${song.thumbnails[0].url}" alt="${song.title}">
                            </div>
                            <div class="playlist-song-info">
                                <h4>${song.title}</h4>
                                <p>${song.uploader}</p>
                            </div>
                            <div class="playlist-song-controls">
                                <button class="play-song" title="Play">
                                    <i class="ri-play-fill"></i>
                                </button>
                                <button class="remove-song" title="Remove from playlist">
                                    <i class="ri-delete-bin-line"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;

            document.body.appendChild(playlistWindow);

            // Add event listeners
            const closeBtn = playlistWindow.querySelector('.close-playlist');
            closeBtn.onclick = () => {
                this.isPlayingPlaylist = false;
                this.currentPlaylist = null;
                playlistWindow.classList.remove('active');
                setTimeout(() => playlistWindow.remove(), 300);
            };

            // Add play and remove handlers
            playlistWindow.querySelectorAll('.playlist-song-item').forEach(item => {
                const songId = item.dataset.id;
                const index = parseInt(item.dataset.index);
                const song = playlist.songs[index];

                item.querySelector('.play-song').onclick = () => {
                    this.isPlayingPlaylist = true;
                    this.upNextSection.classList.add('hidden');
                    this.queue = [...playlist.songs];
                    this.playTrack(index);
                };

                item.querySelector('.remove-song').onclick = async () => {
                    await this.removeSongFromPlaylist(playlistId, songId);
                    item.remove();
                    if (playlist.songs.length === 0) {
                        closeBtn.click();
                    }
                };
            });

            // Show window with animation
            requestAnimationFrame(() => {
                playlistWindow.classList.add('active');
            });

        } catch (error) {
            console.error('Failed to open playlist:', error);
        }
    }

    async removeSongFromPlaylist(playlistId, songId) {
        try {
            const response = await fetch(`/api/playlists/${playlistId}/songs?song_id=${songId}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (result.success) {
                await this.loadPlaylists();
                const playlists = await this.getPlaylists();
                if (playlists[playlistId].songs.length === 0) {
                    // Update playlist display if empty
                    this.renderPlaylists();
                }
            }
        } catch (error) {
            console.error('Failed to remove song from playlist:', error);
        }
    }

    async addSongToPlaylist(playlistId, song) {
        try {
            const response = await fetch(`/api/playlists/${playlistId}/songs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: song.id,
                    title: song.title,
                    uploader: song.uploader,
                    thumbnails: song.thumbnails
                })
            });
            const result = await response.json();
            if (result.success) {
                await this.loadPlaylists();
                // Show success message
                alert('Song added to playlist');
            }
        } catch (error) {
            console.error('Failed to add song to playlist:', error);
            alert('Failed to add song to playlist');
        }
    }

    addToQueue(song) {
        this.queue.push(song);
        this.renderQueue();
    }

    async downloadSong(song) {
        try {
            const response = await fetch(`/api/download/${song.id}`);
            const result = await response.json();
            
            if (result.status === 'success') {
                await this.loadDownloadedSongs();
                alert('Song downloaded successfully!');
            } else {
                alert('Failed to download song');
            }
        } catch (error) {
            console.error('Download failed:', error);
            alert('Failed to download song');
        }
    }

    setupNavigation() {
        const navButtons = document.querySelectorAll('.nav-button');
        const sections = {
            'now-playing': document.querySelector('.now-playing-top'),
            'downloads': document.querySelector('.downloads-section'),
            'playlists': document.querySelector('.playlists-section')
        };
        
        // Initialize sections' visibility
        Object.values(sections).forEach(section => {
            if (section) {
                section.classList.add('hidden');
            }
        });
        
        // Show initial section (Home)
        if (sections['now-playing']) {
            sections['now-playing'].classList.remove('hidden');
        }
        
        navButtons.forEach(button => {
            button.addEventListener('click', () => {
                try {
                    const section = button.dataset.section;
                    if (!section) {
                        console.warn('No section specified for nav button');
                        return;
                    }
                    
                    // Update button states
                    navButtons.forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');
                    
                    // Update section visibility
                    this.showSection(section, sections);
                } catch (error) {
                    console.error('Navigation error:', error);
                }
            });
        });
    }

    showSection(sectionName, sections = null) {
        // Get sections if not provided
        if (!sections) {
            sections = {
                'now-playing': document.querySelector('.now-playing-top'),
                'downloads': document.querySelector('.downloads-section'),
                'playlists': document.querySelector('.playlists-section')
            };
        }

        try {
            // Hide all sections
            Object.values(sections).forEach(section => {
                if (section) {
                    section.classList.add('hidden');
                }
            });

            // Show selected section
            const targetSection = sections[sectionName];
            if (targetSection) {
                targetSection.classList.remove('hidden');
                
                // Load section content as needed
                switch(sectionName) {
                    case 'downloads':
                        this.loadDownloadedSongs();
                        break;
                    case 'playlists':
                        this.loadPlaylists();
                        break;
                }
            }
        } catch (error) {
            console.error('Error switching sections:', error);
        }
    }

    toggleShuffle() {
        // Dummy function for shuffle button
        console.log('Shuffle button clicked');
    }

    toggleLoop() {
        // Dummy function for loop button
        console.log('Loop button clicked');
    }
}

// Add favicon to prevent 404 error
const link = document.createElement('link');
link.rel = 'icon';
link.href = 'data:;base64,iVBORw0KGgo='; // Empty favicon
document.head.appendChild(link);

document.addEventListener('DOMContentLoaded', () => {
    window.player = new MusicPlayer();
});