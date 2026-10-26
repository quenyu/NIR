% Независимая проверка ЭГСП 8-го порядка (MATLAB / GNU Octave, пакет control).
% Передаточная функция строится последовательным сворачиванием структурной
% схемы, как в практическом занятии 02 (рис. 1, приложение 1), но численно.
% Результат пишется в docs/study/octave_egsp.csv для сравнения с программой.
if exist('OCTAVE_VERSION', 'builtin'), pkg load control; end
s = tf('s');
k1 = 50;  a1 = 0.4;  a0 = 80;  b0 = 1;
c2 = 0.3e-6;  c1 = 7e-5;  c0 = 0.1;  d0 = 1;  k4 = 10;
k2 = 1e-3;  k3 = 1/1e-6;  g1 = 0.785e-4;
e2 = 0.005;  e1 = 0.25;  e0 = 2;  f0 = 0.785e-4;  k5 = 4.3;
h1 = 647e-6/(2*1e7);  h0 = 1e-10;  l0 = 1;  q1 = 1.99e-3;
n2 = 10;  n1 = 10;  n0 = 0;  r0 = 1.99e-3;  k6 = 0.1;

W1 = k1;  W2 = b0/(a1*s + a0);  W3 = d0/(c2*s^2 + c1*s + c0);
W4 = k2;  W5 = k3;  W6 = f0/(e2*s^2 + e1*s + e0);  W7 = k5;
W8 = l0/(h1*s + h0);  W9 = r0/(n2*s^2 + n1*s + n0);
W10 = q1*s;  W11 = g1*s;  W12 = k4;  W13 = k6;

W01 = feedback(W5*W6, W11);              % золотник с гидродинамической обратной связью
W02 = feedback(W3*W4*W01, W12);          % якорь ЭМП с механической обратной связью
W03 = feedback(W8*W9, W10);              % гидроцилиндр с поршнем
W   = minreal(feedback(W1*W2*W02*W7*W03, W13), 1e-9);   % главный контур

[num, den] = tfdata(W, 'v');
k = find(abs(den) > 0, 1);  num = num(k:end)/den(k);  den = den/den(k);
num = num(find(abs(num) > 0, 1):end);
t = (0:0.0005:0.7)';
y = lsim(W, 0.01*ones(size(t)), t);
write_result('../../docs/study/octave_egsp.csv', num, den, pole(W), t, y);
