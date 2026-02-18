import torch
from silero_vad import load_silero_vad, read_audio, get_speech_timestamps

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = load_silero_vad().to(device)
wav = read_audio("input.wav")
speech_timestamps = get_speech_timestamps(wav, model, sampling_rate=16000, device=device)
print(speech_timestamps)