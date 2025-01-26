from flask import Flask, render_template, jsonify, send_file, request, Response, stream_with_context
from flask_cors import CORS
import yt_dlp
import threading
import json
import os
from urllib.parse import quote
import requests
import sys
import winreg
import time
import pygame
import webbrowser
import random
import uuid
import subprocess
import tempfile
import re
from urllib.parse import urlparse
import logging
from datetime import datetime

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Global variables
download_progress = {}

logging.basicConfig(
    filename=f'audify_{datetime.now().strftime("%Y%m%d")}.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

class AppDataManager:
    def __init__(self):
        self.app_name = "nnaudify"
        self.app_data_dir = self._get_app_data_path()
        self.downloads_dir = os.path.join(self.app_data_dir, 'downloads')
        self.metadata_file = os.path.join(self.app_data_dir, 'metadata.json')
        self.search_history_file = os.path.join(self.app_data_dir, 'search_history.json')
        self.playlists_file = os.path.join(self.app_data_dir, 'playlists.json')
        self._init_directories()

    def _get_app_data_path(self):
        try:
            if sys.platform == 'win32':
                # Get AppData\Local path on Windows
                key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, 
                                   r'Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders')
                app_data = winreg.QueryValueEx(key, 'Local AppData')[0]
                return os.path.join(app_data, self.app_name)
            else:
                # Use ~/.local/share for Linux/Mac
                return os.path.expanduser(f'~/.local/share/{self.app_name}')
        except Exception as e:
            print(f"Failed to get AppData path: {e}")
            return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'appdata')

    def _init_directories(self):
        os.makedirs(self.app_data_dir, exist_ok=True)
        os.makedirs(self.downloads_dir, exist_ok=True)
        if not os.path.exists(self.metadata_file):
            self._save_metadata({})
        if not os.path.exists(self.search_history_file):
            self._save_search_history([])
        if not os.path.exists(self.playlists_file):
            self._save_playlists({})

    def _save_metadata(self, data):
        with open(self.metadata_file, 'w') as f:
            json.dump(data, f)

    def _load_metadata(self):
        try:
            with open(self.metadata_file, 'r') as f:
                return json.load(f)
        except:
            return {}

    def save_download_info(self, track_info):
        metadata = self._load_metadata()
        metadata[track_info['id']] = {
            'title': track_info['title'],
            'uploader': track_info['uploader'],
            'thumbnail': track_info.get('thumbnail', ''),
            'filename': track_info['filename']
        }
        self._save_metadata(metadata)

    def get_downloads(self):
        metadata = self._load_metadata()
        return [
            {
                'id': track_id,
                **info,
                'path': os.path.join(self.downloads_dir, info['filename'])
            }
            for track_id, info in metadata.items()
            if os.path.exists(os.path.join(self.downloads_dir, info['filename']))
        ]

    def _save_search_history(self, data):
        with open(self.search_history_file, 'w') as f:
            json.dump(data, f)

    def _load_search_history(self):
        try:
            with open(self.search_history_file, 'r') as f:
                return json.load(f)
        except:
            return []

    def add_search_query(self, query):
        history = self._load_search_history()
        if query not in history:
            history.append(query)
            # Keep only last 20 searches
            history = history[-20:]
            self._save_search_history(history)

    def get_recommendations(self):
        history = self._load_search_history()
        downloads = self.get_downloads()
        
        # Combine search history and download titles
        recommendation_sources = history + [
            download['title'] for download in downloads
        ]
        
        if not recommendation_sources:
            return []
            
        # Randomly select a query to base recommendations on
        query = random.choice(recommendation_sources)
        
        # Use YouTubeManager to get recommendations
        yt = YouTubeManager()
        results = yt.search(query)
        if results and len(results) > 0:
            video_id = results[0]['id']
            return yt.get_related(video_id)
        return []

    def _save_playlists(self, data):
        with open(self.playlists_file, 'w') as f:
            json.dump(data, f)

    def _load_playlists(self):
        try:
            with open(self.playlists_file, 'r') as f:
                return json.load(f)
        except:
            return {}

    def create_playlist(self, name):
        playlists = self._load_playlists()
        playlist_id = str(uuid.uuid4())
        playlists[playlist_id] = {
            'name': name,
            'songs': [],
            'created_at': time.time()
        }
        self._save_playlists(playlists)
        return playlist_id

    def add_song_to_playlist(self, playlist_id, song_data):
        playlists = self._load_playlists()
        if playlist_id in playlists:
            if song_data['id'] not in [s['id'] for s in playlists[playlist_id]['songs']]:
                playlists[playlist_id]['songs'].append(song_data)
                self._save_playlists(playlists)
                return True
        return False

    def remove_song_from_playlist(self, playlist_id, song_id):
        playlists = self._load_playlists()
        if playlist_id in playlists:
            playlists[playlist_id]['songs'] = [
                s for s in playlists[playlist_id]['songs']
                if s['id'] != song_id
            ]
            self._save_playlists(playlists)
            return True
        return False

class MusicManager:
    def __init__(self, music_dir='downloads'):
        self.music_dir = music_dir
        os.makedirs(music_dir, exist_ok=True)

    def get_tracks(self):
        return [
            {
                'title': file,
                'path': os.path.join(self.music_dir, file)
            } for file in os.listdir(self.music_dir) 
            if file.endswith(('.mp3', '.wav', '.flac'))
        ]

class YouTubeManager:
    def __init__(self):
        self.app_data = AppDataManager()
        self.base_opts = {
            'quiet': True,
            'no_warnings': True,
            'nocheckcertificate': True,
        }
        
        self.stream_opts = {
            **self.base_opts,
            'format': 'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio',  # Prefer m4a/mp3
            'extract_flat': False,
            'skip_download': True,
        }
        
        # Specific options for search
        self.search_opts = {
            **self.base_opts,
            'extract_flat': False,
        }
        
        # Specific options for related content
        self.related_opts = {
            **self.base_opts,
            'extract_flat': True,
            'skip_download': True,
            'playlistreverse': False,
        }

    def search(self, query):
        with yt_dlp.YoutubeDL(self.search_opts) as ydl:
            try:
                # Only fetch one result initially for faster response
                results = ydl.extract_info(f"ytsearch1:{query}", download=False)
                return [{
                    'id': entry.get('id', ''),
                    'title': entry.get('title', 'Unknown Title'),
                    'uploader': entry.get('uploader', 'Unknown Artist'),
                    'thumbnails': entry.get('thumbnails', [{'url': '/static/default-thumbnail.png'}]),
                    'duration': entry.get('duration', 0)
                } for entry in results['entries']]
            except Exception as e:
                print(f"Search error: {e}")
                return []

    def get_related(self, video_id):
        ydl_opts = {
            'quiet': True,
            'extract_flat': 'in_playlist',
            'ignoreerrors': True,
            'no_warnings': True,
            'playlist_items': '1-11'
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                related_results = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}&list=RD{video_id}",
                    download=False
                )
                
                if related_results and 'entries' in related_results:
                    related = []
                    current_title = None
                    
                    # Get current video title for comparison
                    try:
                        current_info = ydl.extract_info(f"https://youtube.com/watch?v={video_id}", 
                                                      download=False)
                        current_title = current_info.get('title', '').lower()
                    except:
                        pass

                    # Filter out duplicates by title
                    seen_titles = {current_title} if current_title else set()
                    
                    for entry in related_results['entries'][1:11]:
                        if entry:
                            title = entry.get('title', '').lower()
                            if title not in seen_titles:
                                seen_titles.add(title)
                                related.append({
                                    'id': entry.get('id', ''),
                                    'title': entry.get('title', 'Unknown Title'),
                                    'uploader': entry.get('uploader', 'Unknown Artist'),
                                    'thumbnails': entry.get('thumbnails', [{'url': '/static/default-thumbnail.png'}]),
                                    'duration': self.format_duration(entry.get('duration', 0))
                                })
                    return related
                return []
                
        except Exception as e:
            print(f"Related videos error: {str(e)}")
            return []

    def format_duration(self, duration):
        if duration is None:
            return "Unknown"
        try:
            minutes = int(duration // 60)
            seconds = int(duration % 60)
            return f"{minutes}:{seconds:02d}"
        except:
            return "Unknown"

    def get_stream_url(self, video_id):
        try:
            with yt_dlp.YoutubeDL(self.stream_opts) as ydl:
                info = ydl.extract_info(f"https://youtube.com/watch?v={video_id}", download=False)
                
                # Get the best audio format
                formats = info.get('formats', [])
                # Prefer m4a/mp3 formats first
                audio_formats = [
                    f for f in formats 
                    if f.get('ext') in ['m4a', 'mp3'] 
                    and f.get('acodec') != 'none'
                ]
                
                if not audio_formats:
                    audio_formats = [
                        f for f in formats
                        if f.get('acodec') != 'none'
                    ]
                
                if audio_formats:
                    best_audio = max(
                        audio_formats,
                        key=lambda x: float(x.get('abr', 0) or 0)
                    )
                    
                    return {
                        'direct_url': best_audio['url'],
                        'proxied_url': f"/api/proxy/{video_id}",
                        'title': info.get('title', 'Unknown Title'),
                        'duration': info.get('duration', 0),
                        'thumbnail': info.get('thumbnail', ''),
                        'uploader': info.get('uploader', 'Unknown Artist'),
                        'format': best_audio.get('ext', '')
                    }
                
                return None
        except Exception as e:
            print(f"Stream URL error: {str(e)}")
            return None

    def download_track(self, video_id, progress_callback=None):
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(self.app_data.downloads_dir, '%(title)s.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
            }]
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://youtube.com/watch?v={video_id}", download=True)
                filename = ydl.prepare_filename(info).rsplit(".", 1)[0] + ".mp3"
                
                # Save download metadata
                self.app_data.save_download_info({
                    'id': video_id,
                    'title': info.get('title'),
                    'uploader': info.get('uploader'),
                    'thumbnail': info.get('thumbnail'),
                    'filename': os.path.basename(filename)
                })
                
                return os.path.basename(filename)
        except Exception as e:
            print(f"Download error: {e}")
            return None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/tracks')
def list_tracks():
    music_manager = MusicManager()
    return jsonify(music_manager.get_tracks())

@app.route('/download/<filename>')
def download_track(filename):
    music_manager = MusicManager()
    filepath = os.path.join(music_manager.music_dir, filename)
    return send_file(filepath, as_attachment=True)

@app.route('/api/search')
def search():
    query = request.args.get('q', '')
    yt = YouTubeManager()
    results = yt.search(query)
    
    # Save search query
    if results and len(results) > 0:
        app_data = AppDataManager()
        app_data.add_search_query(query)
    
    return jsonify(results)

@app.route('/api/related/<video_id>')
def related(video_id):
    yt = YouTubeManager()
    results = yt.get_related(video_id)
    return jsonify(results)

@app.route('/api/stream/<video_id>')
def get_stream(video_id):
    try:
        yt = YouTubeManager()
        stream_info = yt.get_stream_url(video_id)
        if stream_info and stream_info.get('proxied_url'):
            response = jsonify(stream_info)
            response.headers.update({
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET',
                'Access-Control-Allow-Headers': 'Content-Type',
            })
            return response
        return jsonify({'error': 'No valid stream URL found'}), 400
    except Exception as e:
        print(f"Stream error: {str(e)}")
        return jsonify({'error': str(e)}), 400

@app.route('/api/download/<video_id>')
def download_youtube_track(video_id):
    yt = YouTubeManager()
    try:
        download_progress[video_id] = 0
        filename = yt.download_track(video_id, lambda p: update_download_progress(video_id, p))
        if filename:
            download_progress[video_id] = 1
            return jsonify({'status': 'success', 'filename': filename})
    except Exception as e:
        print(f"Download error: {str(e)}")
    finally:
        if video_id in download_progress:
            del download_progress[video_id]
    return jsonify({'status': 'error', 'message': 'Failed to download track'}), 500

@app.route('/api/download/<video_id>/progress')
def get_download_progress(video_id):
    def generate():
        while True:
            progress = download_progress.get(video_id, 0)
            yield f"data: {{'progress': {progress}}}\n\n"
            if progress >= 1:
                break
            time.sleep(0.1)
    
    return Response(generate(), mimetype='text/event-stream')

def update_download_progress(video_id, progress):
    download_progress[video_id] = progress

# Add new proxy route for audio streaming
@app.route('/api/proxy/<video_id>')
def proxy_stream(video_id):
    try:
        yt = YouTubeManager()
        stream_info = yt.get_stream_url(video_id)
        
        if not stream_info:
            return jsonify({'error': 'Failed to get stream URL'}), 400

        # Get the direct URL from YouTube
        url = stream_info['direct_url']
        
        # Make a streaming request to YouTube
        req = requests.get(url, stream=True)
        
        # Stream the response back to client
        return Response(
            stream_with_context(req.iter_content(chunk_size=2048)),
            content_type=req.headers.get('content-type', 'audio/mp4'),
            headers={
                'Accept-Ranges': 'bytes',
                'Content-Length': req.headers.get('content-length'),
            }
        )

    except Exception as e:
        print(f"Proxy error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/local/<path:filename>')
def serve_local_audio(filename):
    try:
        app_data = AppDataManager()
        file_path = os.path.join(app_data.downloads_dir, filename)
        return send_file(file_path, mimetype='audio/mpeg')
    except Exception as e:
        print(f"Error serving local file: {e}")
        return jsonify({'error': 'File not found'}), 404

@app.route('/api/downloads')
def get_downloads():
    app_data = AppDataManager()
    downloads = app_data.get_downloads()
    return jsonify(downloads)

# Add new route for startup recommendations
@app.route('/api/recommendations')
def get_recommendations():
    app_data = AppDataManager()
    recommendations = app_data.get_recommendations()
    return jsonify(recommendations)

# Add new API routes
@app.route('/api/playlists', methods=['GET', 'POST'])
def handle_playlists():
    app_data = AppDataManager()
    
    if request.method == 'POST':
        data = request.json
        playlist_id = app_data.create_playlist(data['name'])
        return jsonify({'success': True, 'id': playlist_id})
    
    playlists = app_data._load_playlists()
    return jsonify(playlists)

@app.route('/api/playlists/<playlist_id>/songs', methods=['POST', 'DELETE'])
def handle_playlist_songs(playlist_id):
    app_data = AppDataManager()
    
    if request.method == 'POST':
        song_data = request.json
        success = app_data.add_song_to_playlist(playlist_id, song_data)
        return jsonify({'success': success})
    
    song_id = request.args.get('song_id')
    if song_id:
        success = app_data.remove_song_from_playlist(playlist_id, song_id)
        return jsonify({'success': success})
    
    return jsonify({'success': False})

# Add route to handle deleting a playlist
@app.route('/api/playlists/<playlist_id>', methods=['DELETE'])
def delete_playlist(playlist_id):
    app_data = AppDataManager()
    playlists = app_data._load_playlists()
    
    if playlist_id in playlists:
        del playlists[playlist_id]
        app_data._save_playlists(playlists)
        return jsonify({'success': True})
    
    return jsonify({'success': False, 'error': 'Playlist not found'})

class SpotifyImporter:
    def __init__(self, app_data_manager):
        self.app_data = app_data_manager
        self.temp_dir = tempfile.mkdtemp(prefix='spotify_import_')
        self.progress = 0
        self.total_songs = 0
        app.config['spotify_importer'] = self
        self.save_file = os.path.join(self.temp_dir, 'playlist.spotdl')
        self.metadata_file = os.path.join(self.temp_dir, 'song_metadata.txt')

    def validate_spotify_url(self, url):
        """Validate if the URL is a valid Spotify playlist URL"""
        try:
            parsed = urlparse(url)
            valid = (parsed.netloc == 'open.spotify.com' and 
                    'playlist' in parsed.path and 
                    len(parsed.path.split('/')) >= 3)
            logging.info(f"Validating Spotify URL: {url} - Valid: {valid}")
            return valid
        except Exception as e:
            logging.error(f"Error validating Spotify URL: {e}")
            return False

    def cleanup(self):
        """Clean up all temporary files"""
        try:
            if os.path.exists(self.save_file):
                os.remove(self.save_file)
            if os.path.exists(self.metadata_file):
                os.remove(self.metadata_file)
            if os.path.exists(self.temp_dir):
                os.rmdir(self.temp_dir)
            logging.info("Cleaned up temporary files successfully")
        except Exception as e:
            logging.error(f"Error cleaning up temporary files: {e}")

    def get_youtube_urls(self, spotify_url):
        """Get YouTube URLs for all songs in the Spotify playlist"""
        try:
            logging.info(f"Getting song metadata from Spotify playlist: {spotify_url}")
            
            # Save playlist data using spotdl
            cmd = ['spotdl', 'save', spotify_url, '--save-file', self.save_file]
            process = subprocess.run(cmd, capture_output=True, text=True)
            
            if process.returncode != 0:
                logging.error(f"spotdl error: {process.stderr}")
                return None, []

            # Create YouTube manager for consistent metadata format
            yt = YouTubeManager()
            processed_songs = []
            playlist_name = None

            # Read and process save file
            with open(self.save_file, 'r', encoding='utf-8') as f:
                try:
                    # Ensure the JSON data is enclosed in square brackets
                    content = f.read().strip()
                    if not content.startswith('['):
                        content = f'[{content}]'
                    songs = json.loads(content)
                except json.JSONDecodeError as e:
                    logging.error(f"Error parsing JSON: {e}")
                    logging.error(f"Content of save file: {content}")
                    return None, []
            
            self.total_songs = len(songs)
            
            # Process each song using YouTube search
            for i, song in enumerate(songs):
                try:
                    # Search YouTube using song info
                    search_query = f"{song['name']} {song['artist']}"
                    search_results = yt.search(search_query)
                    
                    if search_results and len(search_results) > 0:
                        # Use first result
                        track = search_results[0]
                        processed_songs.append({
                            'id': track['id'],
                            'title': track['title'],
                            'uploader': track['uploader'],
                            'thumbnails': track['thumbnails'],
                            'duration': track['duration']
                        })
                        
                        # Update progress
                        self.progress = ((i + 1) / self.total_songs) * 100
                        logging.info(f"Processed {i+1}/{self.total_songs}: {track['title']}")
                        
                except Exception as e:
                    logging.error(f"Error processing song {song.get('name')}: {e}")
                    continue

            return playlist_name, processed_songs

        except Exception as e:
            logging.error(f"Error getting YouTube URLs: {e}")
            return None, []
        finally:
            self.cleanup()

    def import_playlist(self, spotify_url, custom_name=None):
        """Import songs from Spotify playlist"""
        logging.info(f"Starting playlist import: {spotify_url}")
        self.progress = 0
        
        if not self.validate_spotify_url(spotify_url):
            return {'success': False, 'error': 'Invalid Spotify URL'}

        try:
            # Get processed songs with metadata
            playlist_name, processed_songs = self.get_youtube_urls(spotify_url)
            
            if not processed_songs:
                return {'success': False, 'error': 'No songs found in the Spotify playlist'}

            # Create playlist
            final_name = custom_name or playlist_name or "Imported Playlist"
            playlist_id = self.app_data.create_playlist(final_name)
            
            # Add songs to playlist
            successful_imports = 0
            for song in processed_songs:
                if self.app_data.add_song_to_playlist(playlist_id, song):
                    successful_imports += 1

            return {
                'success': True,
                'playlist_id': playlist_id,
                'name': final_name,
                'song_count': successful_imports,
                'total_songs': len(processed_songs)
            }

        except Exception as e:
            logging.error(f"Playlist import failed: {e}")
            return {'success': False, 'error': str(e)}
        finally:
            self.cleanup()

# Update the import route
@app.route('/api/playlists/import', methods=['POST'])
def import_spotify_playlist():
    try:
        data = request.json
        spotify_url = data.get('spotifyUrl')
        custom_name = data.get('name')
        
        if not spotify_url:
            return jsonify({'success': False, 'error': 'No URL provided'}), 400

        logging.info(f"Received import request for: {spotify_url}")
        app_data = AppDataManager()
        importer = SpotifyImporter(app_data)
        result = importer.import_playlist(spotify_url, custom_name)
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 400

    except Exception as e:
        logging.error(f"Import failed: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlists/import/progress')
def get_import_progress():
    importer = app.config.get('spotify_importer')
    if importer:
        return jsonify({
            'progress': importer.progress,
            'total_songs': importer.total_songs
        })
    return jsonify({'progress': 0, 'total_songs': 0})

class Launcher:
    def __init__(self):
        pygame.init()
        # Increased window size
        self.width = 800
        self.height = 700
        self.window = pygame.display.set_mode((self.width, self.height))
        pygame.display.set_caption("Audify Launcher")
        
        # Button properties
        self.button_width = 200
        self.button_height = 50
        self.button_x = (self.width - self.button_width) // 2
        self.button_y = self.height - 100  # Move button to bottom
        
        # Colors
        self.bg_color = (18, 18, 18)  # Dark background
        self.button_color = (29, 185, 84)  # Spotify green
        self.hover_color = (30, 215, 96)  # Lighter green
        self.text_color = (255, 255, 255)
        self.secondary_text_color = (179, 179, 179)  # Gray for secondary text
        
        # Fonts
        self.title_font = pygame.font.Font(None, 48)
        self.font = pygame.font.Font(None, 36)
        self.small_font = pygame.font.Font(None, 24)
        
        # Server state
        self.server_running = False
        
        # Status message properties
        self.status_text = "Click to Launch"
        self.status_color = self.text_color

        # Features text
        self.features = [
            "🎵 Stream Music",
            "💾 Download Songs for Offline Playback",
            "🎯 Smart Music Recommendations",
            "🎨 Interactive User Interface",
            "⚡ Fast and Responsive",
            "📱 Desktop Application",
        ]

    def draw_title(self):
        # Draw main title
        title = self.title_font.render("Welcome to Audify", True, self.text_color)
        title_rect = title.get_rect(center=(self.width // 2, 50))
        self.window.blit(title, title_rect)
        
        # Draw subtitle
        subtitle = self.small_font.render("Your Personal Music Streaming App", True, self.secondary_text_color)
        subtitle_rect = subtitle.get_rect(center=(self.width // 2, 90))
        self.window.blit(subtitle, subtitle_rect)

    def draw_features(self):
        start_y = 150
        for i, feature in enumerate(self.features):
            text = self.font.render(feature, True, self.text_color)
            text_rect = text.get_rect(x=50, y=start_y + i * 45)
            self.window.blit(text, text_rect)

    def draw_button(self, mouse_pos):
        # Check if mouse is over button
        button_rect = pygame.Rect(self.button_x, self.button_y, self.button_width, self.button_height)
        color = self.hover_color if button_rect.collidepoint(mouse_pos) else self.button_color
        
        # Draw button with rounded corners
        pygame.draw.rect(self.window, color, button_rect, border_radius=10)
        
        # Draw button text
        text = self.font.render("Launch Audify", True, self.text_color)
        text_rect = text.get_rect(center=(self.width // 2, self.button_y + self.button_height // 2))
        self.window.blit(text, text_rect)
        
        # Draw status text below button
        status = self.small_font.render(self.status_text, True, self.status_color)
        status_rect = status.get_rect(center=(self.width // 2, self.button_y + self.button_height + 20))
        self.window.blit(status, status_rect)
        
        return button_rect

    def run_server(self):
        app.run(debug=False, threaded=True)

    def open_browser(self):
        webbrowser.open('http://127.0.0.1:5000')

    def run(self):
        running = True
        while running:
            mouse_pos = pygame.mouse.get_pos()
            
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                elif event.type == pygame.MOUSEBUTTONDOWN:
                    button_rect = pygame.Rect(self.button_x, self.button_y, 
                                           self.button_width, self.button_height)
                    if button_rect.collidepoint(mouse_pos) and not self.server_running:
                        # Update status while server starts
                        self.status_text = "Starting server..."
                        self.status_color = self.button_color
                        pygame.display.flip()
                        
                        # Start server in a separate thread
                        server_thread = threading.Thread(target=self.run_server)
                        server_thread.daemon = True
                        server_thread.start()
                        
                        # Wait a moment for server to start
                        pygame.time.wait(1500)
                        
                        # Open browser
                        self.open_browser()
                        
                        self.server_running = True
                        self.status_text = "Server Running - Click X to Close"
                        self.status_color = self.button_color
            
            # Draw everything
            self.window.fill(self.bg_color)
            self.draw_title()
            self.draw_features()
            self.draw_button(mouse_pos)
            pygame.display.flip()
        
        pygame.quit()

if __name__ == "__main__":
    launcher = Launcher()
    launcher.run()
