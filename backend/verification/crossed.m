% Независимая проверка схемы с перекрёстными обратными связями (MATLAB / GNU Octave).
% Контуры H1 (выход G2 -> вход G1) и H2 (выход G3 -> вход G2) перекрываются, поэтому
% сворачивание идёт с переносом узла: точка съёма H1 переносится с выхода G2 на выход G3,
% в цепь H1 добавляется 1/G3.
if exist('OCTAVE_VERSION', 'builtin'), pkg load control; end
s = tf('s');
G1 = 1/(s + 1);  G2 = 2/(0.5*s + 1);  G3 = 1/s;  H1 = 0.5;  H2 = 1;
inner = feedback(G2*G3, H2);                  % внутренний контур G2-G3 с H2
loop1 = feedback(G1*inner, H1/G3);            % контур H1 после переноса узла
W = minreal(feedback(loop1, 1), 1e-9);        % главная обратная связь
[num, den] = tfdata(W, 'v');
k = find(abs(den) > 0, 1);  num = num(k:end)/den(k);  den = den/den(k);
num = num(find(abs(num) > 0, 1):end);
t = (0:0.01:10)';
y = lsim(W, ones(size(t)), t);
write_result('../../docs/study/octave_crossed.csv', num, den, pole(W), t, y);
