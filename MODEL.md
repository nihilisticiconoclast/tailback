# The model

## The claim

One car brakes. Some cars behind it are forced to brake. Some cars behind
*those* are forced to brake. If the number of cars each braking car forces to
brake is Poisson with mean $\mu$, then the total number of cars caught in the
cascade — the original included — is Borel distributed:

$$
P(N = n) = \frac{e^{-\mu n} (\mu n)^{n-1}}{n!}, \qquad n = 1, 2, 3, \dots
$$

Everything below is either the derivation of that, the argument that traffic
actually gives you a Poisson offspring law, or the consequences.

## Total progeny of a Galton–Watson process

Take a branching process with offspring distribution $X$, $\mathbb{E}[X] = \mu$,
and let $N$ be its total progeny: every node the tree ever contains. Borel's
result is the special case $X \sim \text{Poisson}(\mu)$, and the cleanest route
to it is Dwass' identity. If $X_1, \dots, X_n$ are i.i.d. copies of the offspring
law,

$$
P(N = n) = \frac{1}{n} P\!\left(\sum_{i=1}^{n} X_i = n - 1\right).
$$

The intuition is the hitting-time or cycle-lemma argument: a tree with $n$ nodes
requires exactly $n-1$ children in total across those nodes, and exactly one of
the $n$ cyclic rotations of the corresponding step sequence is a valid tree.

Poisson is closed under convolution, so $\sum_{i=1}^{n} X_i \sim \text{Poisson}(n\mu)$,
and substituting gives

$$
P(N = n) = \frac{1}{n} \cdot \frac{e^{-n\mu} (n\mu)^{n-1}}{(n-1)!}
= \frac{e^{-\mu n} (\mu n)^{n-1}}{n!}.
$$

Sanity checks that `test/smoke.mjs` runs against the code: $P(1) = e^{-\mu}$, the
root having no children. $P(2) = \mu e^{-2\mu}$, one child which is itself
childless. $P(3) = \tfrac{3}{2}\mu^2 e^{-3\mu}$, which is the sum of the two
possible three-node shapes — a root with two childless children, and a chain of
three.

## Why traffic gives you a Poisson offspring law

Because the cascade is an M/D/1 busy period, and that correspondence is exact
rather than approximate.

Fix a point on the road where the disturbance happens. A car brakes there and
occupies the point for $D$ seconds before the next car can get through. Any car
arriving during those $D$ seconds has to brake too, and then occupies the point
for its own $D$ seconds. The disturbance persists until nobody is waiting.

This is a single-server queue with deterministic service time $D$. The busy
period ends when the system empties, and the number of customers served in a
busy period is the total progeny of a branching process whose offspring counts
are the arrivals during each service window. Because consecutive service windows
$[0, D), [D, 2D), \dots$ are **disjoint**, and arrivals are Poisson with rate
$\lambda$, those counts are i.i.d. $\text{Poisson}(\lambda D)$. So

$$
\mu = \lambda D = \rho,
$$

the traffic intensity of the bottleneck, and $N \sim \text{Borel}(\rho)$.

Disjointness is the load-bearing assumption. The tempting spatial version — a
braking car casts a "shadow" of road behind it, everything in the shadow brakes,
each of those casts its own shadow — is *not* exactly Borel, because a child's
shadow overlaps its parent's and the counts are no longer independent. The
time-domain queue avoids this because service is sequential by construction.

Serving FIFO means the tree is generated breadth-first, so node index equals
service order. That is what lets the visualisation light each node exactly as
its car is released.

## From sliders to $\mu$

The controls expose quantities you can point at on a road, and the fundamental
relation of traffic flow does the rest:

$$
k = \frac{N_{\text{cars}}}{L}, \qquad q = k v, \qquad \mu = q D.
$$

Density $k$ in vehicles per metre, speed $v$ in metres per second, so flow $q$
comes out in vehicles per second past a fixed point, and multiplying by the
clearance time $D$ in seconds gives a dimensionless $\mu$. Every route to a
larger $\mu$ is a route people recognise: more cars, a shorter loop, faster
traffic, or a slower-clearing disturbance.

## The three regimes

**Subcritical, $\mu < 1$.** The cascade dies out with probability 1 and

$$
\mathbb{E}[N] = \frac{1}{1-\mu}, \qquad \operatorname{Var}(N) = \frac{\mu}{(1-\mu)^3}.
$$

Both blow up as $\mu \to 1$, and the variance blows up faster. Long before the
mean looks alarming, the spread does: at $\mu = 0.9$ the average tailback is 10
cars and the standard deviation is about 30.

**Critical, $\mu = 1$.** The cascade still terminates with probability 1, but
$\mathbb{E}[N] = \infty$. The distribution is proper and its tail is
$P(N = n) \sim n^{-3/2} / \sqrt{2\pi}$ by Stirling — the classic critical
branching exponent, and heavy enough that the mean does not exist.

**Supercritical, $\mu > 1$.** The Borel formula no longer sums to 1. It sums to
the extinction probability $q$, the smallest root of

$$
q = e^{-\mu(1-q)},
$$

and the missing mass $1 - q$ is the probability that the jam never clears. The
formula is *defective*, not wrong: it still gives the probability of each finite
outcome.

Conditioning on the jam clearing recovers a proper distribution with a dual
parameter. Writing $e^{\mu(1-q)} = 1/q$,

$$
\frac{\text{Borel}(\mu q)(n)}{\text{Borel}(\mu)(n)}
= e^{\mu n (1-q)} q^{n-1} = q^{-n} q^{n-1} = \frac{1}{q},
$$

so $\text{Borel}(\mu)(n) = q \cdot \text{Borel}(\mu q)(n)$ for every $n$. A
supercritical cascade, conditioned on being finite, is exactly a subcritical
Borel with parameter $\mu q < 1$, and its conditional mean is $1/(1 - \mu q)$.

The code exploits this: `deriveMetrics` returns `muEff = mu * q`, which equals
$\mu$ below criticality because $q = 1$ there. One parameter, one code path, and
the theory curve on the chart is correct in every regime.

## Numerical notes

$(\mu n)^{n-1}$ overflows a double at around $n = 150$, and $n!$ overflows a
little before that. `borel.js` computes

$$
\log P(n) = -\mu n + (n-1)\log(\mu n) - \log n!
$$

with $\log n!$ from a cached cumulative sum of $\log k$, and exponentiates once.
This stays accurate into the thousands; the test asserts $P(5000 \mid \mu = 0.9)$
is finite and non-zero, which the naive form is not.

The extinction probability is found by iterating $q \mapsto e^{-\mu(1-q)}$ from
$q = 0$. The map is increasing, so the sequence rises monotonically to the
smallest fixed point, with linear convergence at rate $\mu q < 1$.

Poisson variates use Knuth's product method below mean 30 — expected iterations
$\mu + 1$, so it is cheap in the regime that matters — and a normal
approximation above, where the process is so far supercritical that exactness
buys nothing.

## What the circuit is and isn't

The histogram is fed by the exact M/D/1 sampler and converges to Borel. That
part is honest.

The circuit is now a simulation too, not a rendering of a number computed
elsewhere. A car is caught when it would reach the disturbance while the server
is still working,

$$\text{now} + \frac{\text{distance}}{\text{speed}} < W,$$

where $W$ is the instant everything caught so far will have cleared; catching a
car pushes $W$ out by another $D$. That is the definition of a busy period. Each
cascade's size is counted as it happens, and the tree records which car's
clearance window caught which.

Measured over 3000 cascades at $\mu = 0.700$, the number of cars the first
braker catches is Poisson to three decimal places (mean $0.699$), and
$P(N = n)$ matches Borel across the common sizes.

Two things are idealised:

**The queue is vertical.** It is drawn stretching back along the road so the
tailback is legible, but it occupies no length in the arithmetic. This matters
more than it sounds: catching a car when the physical tail reaches it, rather
than when the car reaches the disturbance, adds $(\text{queue length})/v$ to
every clearance window. At the defaults that lifts an intended $\mu = 0.70$
above 1 and cascades stop terminating.

**Released cars catch up.** A car leaving the queue is behind where the
undisturbed stream would have put it, and closes the gap at $2.2v$. The stream
itself is never perturbed by the queue, which is what keeps arrivals Poisson.

The real limitation is the finite loop. Borel's mean is dominated by its tail,
and 45 cars cannot produce a cascade of 200, so the circuit's cascades run about
10% small in the mean while the common sizes stay right. The histogram samples
the idealised process with no such cap, which is why it is the authority for the
shape of the law.

## Generalisation

If a cascade is seeded by $k$ cars braking at once rather than one, the total
progeny is Borel–Tanner:

$$
P(N = n) = \frac{k}{n} \cdot \frac{e^{-\mu n} (\mu n)^{n-k}}{(n-k)!}, \qquad n \geq k.
$$

`borelTannerPmf` implements this; it reduces to Borel at $k = 1$, which the test
checks. It is not yet wired to a control.

## Sources worth reading

Borel's 1942 note is the original; Tanner (1953, 1961) is where the traffic
connection is made properly, including the queue at a minor road crossing a
Poisson stream on a major one. Haight and Breuer (1960) name the Borel–Tanner
family. For the branching-process machinery, Otter (1949) and Dwass (1969) give
the total-progeny identity used above.
