% Независимая проверка контура с ПИ-регулятором (MATLAB / GNU Octave, пакет control).
if exist('OCTAVE_VERSION', 'builtin'), pkg load control; end
s = tf('s');
kp = 2;  ki = 1;  T1 = 1;  T2 = 0.5;
C = kp + ki/s;                         % ПИ-регулятор
P = 1/((T1*s + 1)*(T2*s + 1));         % объект: два инерционных звена
W = minreal(feedback(C*P, 1), 1e-9);   % единичная отрицательная обратная связь
[num, den] = tfdata(W, 'v');
k = find(abs(den) > 0, 1);  num = num(k:end)/den(k);  den = den/den(k);
num = num(find(abs(num) > 0, 1):end);
t = (0:0.01:15)';
y = lsim(W, ones(size(t)), t);
write_result('../../docs/study/octave_pi.csv', num, den, pole(W), t, y);
