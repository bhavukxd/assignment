import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';

function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const payload = isRegister ? { email, password, name } : { email, password };
      
      const res = await api.post(endpoint, payload);
      
      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
      }
      
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 20, border: '1px solid #ccc', borderRadius: 8 }}>
      <h2>{isRegister ? 'Register' : 'Login'}</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      
      <form onSubmit={handleSubmit}>
        {isRegister && (
          <div style={{ marginBottom: 10 }}>
            <label>Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required style={{ width: '100%', padding: 8 }} />
          </div>
        )}
        
        <div style={{ marginBottom: 10 }}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={{ width: '100%', padding: 8 }} />
        </div>
        
        <div style={{ marginBottom: 10 }}>
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={{ width: '100%', padding: 8 }} />
        </div>
        
        <button type="submit" style={{ width: '100%', padding: 10, background: '#007bff', color: 'white', border: 'none', borderRadius: 4 }}>
          {isRegister ? 'Register' : 'Login'}
        </button>
      </form>
      
      <p style={{ textAlign: 'center', marginTop: 10 }}>
        <button onClick={() => setIsRegister(!isRegister)} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer' }}>
          {isRegister ? 'Already have an account? Login' : 'Need an account? Register'}
        </button>
      </p>
    </div>
  );
}

export default Login;