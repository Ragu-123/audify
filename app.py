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

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

download_progress = {}

class AppDataManager:
    def __init__(self):
        self.app_name = "nnaudify"
        self.app_data_dir = self._get_app_data_path()
        self.downloads_dir = os.path.join(self.app_data_dir, 'downloads')
        self.metadata_file = os.path.join(self.app_data_dir, 'metadata.json')
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

if __name__ == '__main__':
    import webbrowser
    import threading
    
    def open_browser():
        webbrowser.open('http://127.0.0.1:5000')
    
    # Start browser thread
    threading.Timer(1.5, open_browser).start()
    
    # Run the server
    app.run(debug=False)