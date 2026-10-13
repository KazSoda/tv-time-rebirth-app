export const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY ?? '';
export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
export const TMDB_IMG = {
  poster_sm: 'https://image.tmdb.org/t/p/w185',
  poster_md: 'https://image.tmdb.org/t/p/w342',
  backdrop:  'https://image.tmdb.org/t/p/w780',
  still:     'https://image.tmdb.org/t/p/w300',
};
// Rétrocompatibilité avec l'ancien nom
export const TMDB_IMAGE_BASE_URL = TMDB_IMG.poster_sm;
